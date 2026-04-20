// Express + Socket.io サーバー
// public/ を静的配信し、Socket.io でルーム機能を提供する

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const RoomManager = require("./src/roomManager");
const GameState = require("./src/gameState");
const { initBattle, PLAYER_HP, PLAYER_MAX_HP, INITIAL_HAND_SIZE, playerSelectCard, playerReady, resolveCards, enemyAttack, drawCards, shuffleArray } = require("./src/gameLogic");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const roomManager = new RoomManager();
// roomId => GameState
const gameStates = new Map();

const PORT = process.env.PORT || 3000;

// public/ ディレクトリを静的ファイルとして配信する
app.use(express.static(path.join(__dirname, "public")));

/**
 * 全員ターン終了が確定したルームに対し、解決サイクルを進行させる共通処理。
 *
 * 流れ：
 *   1. resolving フェーズをブロードキャスト
 *   2. resolveCards でカード効果以外のターン終了処理を実行（手札→捨て札・状態異常・一時筋力解除）
 *   3. 敵HPが0以下なら finished をブロードキャストして reward_start を通知し終了
 *   4. enemy_turn フェーズをブロードキャストし、1000ms 待機
 *   5. setTimeout 内で enemyAttack を実行し selecting へ遷移
 *
 * ※ end_turn ハンドラと disconnect ハンドラの両方から呼び出される。
 *    （切断によって残った接続中プレイヤー全員がターン終了済みになるケースに対応するため）
 *
 * @param {string} roomId
 * @param {GameState} gs
 */
function runResolveAndEnemyTurn(roomId, gs) {
  // 二重起動を防ぐためのガード：phase が selecting でなければ既に解決サイクル中
  if (gs.phase !== "selecting") {
    return;
  }

  // resolving フェーズをブロードキャストする
  gs.phase = "resolving";
  io.to(roomId).emit("game_state_update", gs.toJSON());
  console.log(`ルーム ${roomId} の全員がターン終了 → resolving フェーズへ`);

  // ターン終了処理（ステータス効果・手札捨て札移動）を行う
  // phase は enemy_turn または finished になる
  resolveCards(gs);
  console.log(`ルーム ${roomId} の resolveCards 完了 → ${gs.phase} フェーズへ`);

  // 敵HPが0以下（phase === 'finished'）なら報酬開始を通知して敵ターンをスキップする
  if (gs.phase === "finished") {
    io.to(roomId).emit("game_state_update", gs.toJSON());
    io.to(roomId).emit("reward_start", { reason: "enemy_defeated" });
    return;
  }

  // enemy_turn フェーズをブロードキャストする（クライアントで ENEMY TURN 表示を出すため）
  io.to(roomId).emit("game_state_update", gs.toJSON());

  // 1000ms 待機後に敵の攻撃フェーズを実行する
  setTimeout(() => {
    // この間に状態が破棄・差し替えされている可能性があるためチェックする
    // （roomId が同じでも gs が新しい GameState に差し替わっている可能性があるため同一性を確認する）
    if (gameStates.get(roomId) !== gs) {
      return;
    }
    // setTimeout 中に他経路で phase が変わっている場合は二重実行を避ける
    if (gs.phase !== "enemy_turn") {
      return;
    }
    enemyAttack(gs);
    console.log(`ルーム ${roomId} の enemyAttack 完了 → ${gs.phase} フェーズへ`);
    io.to(roomId).emit("game_state_update", gs.toJSON());

    // 敵の攻撃で全員死亡した場合は敗北を通知する
    if (gs.phase === "finished") {
      io.to(roomId).emit("defeat_start", { reason: "all_players_defeated" });
    }
  }, 1000);
}

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

    // リダイレクト後の再接続：gameStateに同じプレイヤー名の旧エントリがあれば付け替える
    const gs = gameStates.get(roomId);
    if (gs) {
      let oldSocketId = null;
      for (const [sid, player] of gs.players.entries()) {
        if (player.name === playerName && sid !== socket.id) {
          oldSocketId = sid;
          break;
        }
      }
      if (oldSocketId) {
        gs.remapPlayer(oldSocketId, socket.id);
        console.log(`プレイヤー ${playerName} のsocket.idを ${oldSocketId} → ${socket.id} に付け替え`);
      }
    }

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

      // ゲーム状態の扱い：
      //   - 待機中(waiting) または 終了済み(finished) の場合のみプレイヤーをgsからも削除し、
      //     プレイヤーが0人になったらgameStateを破棄する。
      //   - ゲーム進行中はプレイヤーデータを保持しつつ「切断中」フラグを立てる。
      //     リダイレクト後の再接続でsocket.idが変わってもremapPlayerで復元できるよう、
      //     既存プレイヤーの進行データ（HP・手札・デッキ等）を保護するため。
      const gs = gameStates.get(roomId);
      if (!gs) {
        return;
      }
      if (gs.phase === "waiting" || gs.phase === "finished") {
        gs.removePlayer(socket.id);
        if (gs.players.size === 0) {
          gameStates.delete(roomId);
        }
      } else {
        // 進行中：プレイヤーデータは残し、切断中とマークする
        gs.markDisconnected(socket.id);
        io.to(roomId).emit("game_state_update", gs.toJSON());

        // 切断によって「残った接続中プレイヤー全員がターン終了済み」になった場合、
        // 解決サイクルを起動する必要がある（B1: 旧コードでは end_turn ハンドラ側でしか
        // 起動されなかったため、切断のみで全員 ready 状態になると進行が永久停止していた）。
        if (gs.phase === "selecting" && gs.allPlayersReady()) {
          runResolveAndEnemyTurn(roomId, gs);
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

  // select_card イベント：プレイヤーがカードを使用する（サーバー権威）
  // payload: { roomId: string, cardId: string }
  socket.on("select_card", (payload) => {
    const roomId = String(payload?.roomId || "").trim();
    const cardId = String(payload?.cardId || "").trim();
    const gs = gameStates.get(roomId);

    if (!gs) {
      return;
    }

    // サーバー権威：カードの使用可否を検証し、合格なら効果を即時適用する。
    // フェーズチェック・手札所持・エネルギー・ターン終了済みなどはplayerSelectCard内で検証する。
    const result = playerSelectCard(gs, socket.id, cardId);

    if (!result.success) {
      // 不正な使用要求（マナ不足・ターン終了後・手札にない等）は無視するが、
      // 該当プレイヤーへ最新状態を再送して画面の不整合を防ぐ
      socket.emit("game_state_update", gs.toJSON());
      return;
    }

    // カード使用後の状態をルーム全員にブロードキャストする
    io.to(roomId).emit("game_state_update", gs.toJSON());

    // 敵がカードで撃破された場合は報酬画面開始を全員に通知する
    if (result.enemyDefeated) {
      io.to(roomId).emit("reward_start", { reason: "enemy_defeated" });
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
  // 全員揃ったら resolveCards → game_state_update(enemy_turn) → 1000ms待機 → enemyAttack を実行する
  // payload: { roomId: string }
  socket.on("end_turn", (payload) => {
    const roomId = String(payload?.roomId || "").trim();
    const gs = gameStates.get(roomId);

    if (!gs) {
      return;
    }

    // selecting以外（resolving/enemy_turn等）の end_turn は無視する
    if (gs.phase !== "selecting") {
      return;
    }
    // 切断中・存在しないプレイヤーからの end_turn は無視する
    const playerData = gs.players.get(socket.id);
    if (!playerData || playerData.disconnected) {
      return;
    }

    // 準備完了プレイヤーに追加する
    gs.readyPlayers.add(socket.id);

    // 待機人数を全員に通知する
    io.to(roomId).emit("game_state_update", gs.toJSON());

    // 全員揃った場合に解決処理を実行する
    if (gs.allPlayersReady()) {
      runResolveAndEnemyTurn(roomId, gs);
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
    // 切断中プレイヤーは除外し、接続中の全員が選択済みかどうかを確認する
    const connectedIds = Array.from(gs.players.entries())
      .filter(([, p]) => !p.disconnected)
      .map(([id]) => id);
    const allCurrentPlayersSelected = connectedIds.length > 0 &&
      connectedIds.every((id) => gs.rewardSelected.has(id));
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
