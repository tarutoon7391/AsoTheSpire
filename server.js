// Express + Socket.io サーバー
// public/ を静的配信し、Socket.io でルーム機能を提供する

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const RoomManager = require("./src/roomManager");
const GameState = require("./src/gameState");
const { initBattle, playerSelectCard, playerReady, resolveCards } = require("./src/gameLogic");

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
        // ルームにプレイヤーがいなくなったらゲーム状態を破棄する
        if (gs.players.size === 0) {
          gameStates.delete(roomId);
        }
      }
    });
  });

  // battle_start イベント：ルーム内の全員にinitBattleを実行してgame_state_updateをブロードキャストする
  // payload: { roomId: string }
  socket.on("battle_start", (payload) => {
    const roomId = String(payload?.roomId || "").trim();
    const roomView = roomManager.getRoomView(roomId);

    if (!roomView) {
      socket.emit("join_error", { error: "ルームが存在しません" });
      return;
    }

    // ゲーム状態が未作成なら新規作成し、ルーム参加者をすべて登録する
    if (!gameStates.has(roomId)) {
      const gs = new GameState(roomId);
      roomView.players.forEach((p) => gs.addPlayer(p.socketId, p.playerName));
      gameStates.set(roomId, gs);
    }

    const gs = gameStates.get(roomId);
    initBattle(gs);

    console.log(`ルーム ${roomId} のバトルを開始`);
    io.to(roomId).emit("game_state_update", gs.toJSON());
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
    io.to(roomId).emit("game_state_update", gs.toJSON());
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
});

server.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
