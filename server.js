// Express + Socket.io サーバー
// public/ を静的配信し、Socket.io でルーム機能を提供する

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const RoomManager = require("./src/roomManager");
const GameState = require("./src/gameState");
const { initBattle, PLAYER_HP, PLAYER_MAX_HP, INITIAL_HAND_SIZE, playerSelectCard, playerReady, resolveCards, enemyAttack, applyCardToEnemy, drawCards, shuffleArray } = require("./src/gameLogic");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const roomManager = new RoomManager();
// roomId => GameState
const gameStates = new Map();

const PORT = process.env.PORT || 3000;

// public/ ディレクトリを静的ファイルとして配信する
app.use(express.static(path.join(__dirname, "public")));

// Socket.io 接続処理
io.on("connection", (socket) => {
  console.log(`接続: ${socket.id}`);

  // join_room イベント：ルームへの参加リクエストを処理する
  // payload: { roomId: string, playerName: string }
  socket.on("join_room", (payload) => {
    const roomId = String(payload?.roomId || "").trim();
    const playerName = String(payload?.playerName || "").trim();

    if (!roomId || !playerName) {
      socket.emit("join_error", { error: "ルームIDとプレイヤー名は必須です" });
      return;
    }

    const result = roomManager.joinRoom(roomId, socket.id, playerName);

    if (!result.success) {
      socket.emit("join_error", { error: result.error });
      return;
    }

    // Socket.io の room 機能を使ってルームに参加させる
    socket.join(roomId);

    // ルーム全員に参加者リストをブロードキャストする
    io.to(roomId).emit("room_update", result.room);

    console.log(`${playerName}（${socket.id}）がルーム ${roomId} に参加`);
  });

  // disconnect イベント：切断時にルームから削除する
  socket.on("disconnect", () => {
    console.log(`切断: ${socket.id}`);

    const affectedRoomIds = roomManager.removeSocket(socket.id);

    // 影響を受けたルームに更新済みの参加者リストをブロードキャストする
    affectedRoomIds.forEach((roomId) => {
      const roomView = roomManager.getRoomView(roomId);
      if (roomView) {
        io.to(roomId).emit("room_update", roomView);
      }

      // ゲーム状態からも該当プレイヤーを削除する
      const gs = gameStates.get(roomId);
      if (gs) {
        gs.removePlayer(socket.id);
        // ゲームが待機中または終了済みの場合のみgameStateを削除する
        // 進行中のゲームはリダイレクト後の再接続に備えて状態を保持する
        if (gs.players.size === 0 && (gs.phase === "waiting" || gs.phase === "finished")) {
          gameStates.delete(roomId);
        }
      }
    });
  });

  // battle_start イベント：ルーム内の全員にinitBattleを実行してgame_state_updateをブロードキャストする
  // ゲームがすでに進行中の場合はこのsocketを既存のゲームに再参加させて現在の状態を返す
  // payload: { roomId: string, playerName: string }
  socket.on("battle_start", (payload) => {
    const roomId = String(payload?.roomId || "").trim();
    const playerName = String(payload?.playerName || "").trim();
    const roomView = roomManager.getRoomView(roomId);

    if (!roomView) {
      socket.emit("join_error", { error: "ルームが存在しません" });
      return;
    }

    // Socket.io の room に参加させる（リダイレクト後の再接続でも有効にする）
    socket.join(roomId);

    if (!gameStates.has(roomId)) {
      // ゲーム状態が未作成なら新規作成してバトルを初期化する
      const gs = new GameState(roomId);
      roomView.players.forEach((p) => gs.addPlayer(p.socketId, p.playerName));
      gameStates.set(roomId, gs);
      initBattle(gs);

      console.log(`ルーム ${roomId} のバトルを開始`);
      io.to(roomId).emit("game_state_update", gs.toJSON());
      // ルーム全員を game.html?mode=multi にリダイレクトさせる
      io.to(roomId).emit("battle_redirect", { redirect: "/game.html?mode=multi" });
    } else {
      // ゲームがすでに進行中 → このsocketを既存ゲームに再接続させる
      const gs = gameStates.get(roomId);

      if (!gs.players.has(socket.id)) {
        // gameStateに存在しないプレイヤーを追加して初期化する（リダイレクト後の再接続）
        gs.addPlayer(socket.id, playerName || socket.id);
        const player = gs.players.get(socket.id);
        player.hp = PLAYER_HP;
        player.maxHp = PLAYER_MAX_HP;
        player.energy = player.maxEnergy || 3;
        player.hand = [];
        player.discard = [];
        shuffleArray(player.deck);
        drawCards(player, INITIAL_HAND_SIZE);
      }

      console.log(`ルーム ${roomId} にプレイヤー（${socket.id}）が再接続`);
      // 現在のゲーム状態をこのsocketだけに送信する
      socket.emit("game_state_update", gs.toJSON());
    }
  });

  // select_card イベント：プレイヤーがカードを選択する
  // payload: { roomId: string, cardId: string }
  socket.on("select_card", (payload) => {
    const roomId = String(payload?.roomId || "").trim();
    const cardId = String(payload?.cardId || "").trim();
    const gs = gameStates.get(roomId);

    if (!gs) {
      return;
    }

    playerSelectCard(gs, socket.id, cardId);
    // カード選択直後に敵HPとステータスをリアルタイムで反映してルーム全員に通知する
    applyCardToEnemy(gs, socket.id);

    // 敵HPが0以下になった場合は終了フェーズへ移行して報酬開始を通知する
    if (gs.enemy.hp <= 0 && gs.phase !== "finished") {
      gs.phase = "finished";
      io.to(roomId).emit("game_state_update", gs.toJSON());
      io.to(roomId).emit("reward_start", { reason: "enemy_defeated" });
    } else {
      io.to(roomId).emit("game_state_update", gs.toJSON());
    }
  });

  // player_ready イベント：プレイヤーが準備完了を宣言する
  // 全員揃ったらphaseを'resolving'にしてgame_state_updateをブロードキャストする
  // payload: { roomId: string }
  socket.on("player_ready", (payload) => {
    const roomId = String(payload?.roomId || "").trim();
    const gs = gameStates.get(roomId);

    if (!gs) {
      return;
    }

    const allReady = playerReady(gs, socket.id);

    if (allReady) {
      // まず resolving フェーズをブロードキャストして全クライアントに通知する
      gs.phase = "resolving";
      io.to(roomId).emit("game_state_update", gs.toJSON());
      console.log(`ルーム ${roomId} の全員が準備完了 → resolving フェーズへ`);

      // カード効果を一括解決してフェーズを更新する
      resolveCards(gs);
      console.log(`ルーム ${roomId} の resolveCards 完了 → ${gs.phase} フェーズへ`);
    }

    io.to(roomId).emit("game_state_update", gs.toJSON());
  });

  // end_turn イベント：プレイヤーがターン終了を宣言する
  // 全員揃ったら resolveCards → 500ms待機 → enemyAttack を実行する
  // payload: { roomId: string }
  socket.on("end_turn", (payload) => {
    const roomId = String(payload?.roomId || "").trim();
    const gs = gameStates.get(roomId);

    if (!gs) {
      return;
    }

    // 準備完了プレイヤーに追加する
    gs.readyPlayers.add(socket.id);

    // 待機人数を全員に通知する
    io.to(roomId).emit("game_state_update", gs.toJSON());

    // 全員揃った場合に解決処理を実行する
    if (gs.allPlayersReady()) {
      // resolving フェーズをブロードキャストする
      gs.phase = "resolving";
      io.to(roomId).emit("game_state_update", gs.toJSON());
      console.log(`ルーム ${roomId} の全員がターン終了 → resolving フェーズへ`);

      // カード効果を解決する
      resolveCards(gs);
      console.log(`ルーム ${roomId} の resolveCards 完了 → ${gs.phase} フェーズへ`);

      // 敵HPが0以下（phase === 'finished'）なら報酬開始を通知して敵ターンをスキップする
      if (gs.phase === "finished" && gs.enemy.hp <= 0) {
        io.to(roomId).emit("game_state_update", gs.toJSON());
        io.to(roomId).emit("reward_start", { reason: "enemy_defeated" });
        return;
      }

      // 500ms 待機後に敵の攻撃フェーズを実行する
      setTimeout(() => {
        enemyAttack(gs);
        console.log(`ルーム ${roomId} の enemyAttack 完了 → ${gs.phase} フェーズへ`);
        io.to(roomId).emit("game_state_update", gs.toJSON());
      }, 500);
    }
  });

  // reward_selected イベント：プレイヤーが報酬カードを選択する
  // payload: { roomId: string, cardId: string }
  socket.on("reward_selected", (payload) => {
    const roomId = String(payload?.roomId || "").trim();
    const gs = gameStates.get(roomId);

    if (!gs) {
      return;
    }

    // マイグレーション：古いゲーム状態に rewardSelected がない場合は補完する
    if (!gs.rewardSelected) {
      gs.rewardSelected = new Set();
    }

    gs.rewardSelected.add(socket.id);

    // 全員が報酬カードを選択したら次のバトルを開始する
    // 現在も接続中のプレイヤー全員が選択済みかどうかを確認する
    const allCurrentPlayersSelected = gs.players.size > 0 &&
      Array.from(gs.players.keys()).every((id) => gs.rewardSelected.has(id));
    if (allCurrentPlayersSelected) {
      gs.rewardSelected = new Set();
      initBattle(gs);
      console.log(`ルーム ${roomId} の全員が報酬選択完了 → 次のバトル開始`);
      io.to(roomId).emit("game_state_update", gs.toJSON());
      io.to(roomId).emit("battle_start_next", {});
    }
  });
});

server.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
