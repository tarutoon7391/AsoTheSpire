// Express + Socket.io サーバー
// public/ を静的配信し、Socket.io でルーム機能を提供する

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const RoomManager = require("./src/roomManager");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const roomManager = new RoomManager();

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
    });
  });
});

server.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
