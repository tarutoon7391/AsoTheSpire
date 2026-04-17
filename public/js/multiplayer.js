// Socket.io クライアント初期化・ルーム送受信のみ実装
// ゲームロジックはまだ不要なため含めない

(function createMultiplayerModule() {
  // Socket.io クライアントを初期化する（サーバーと同一オリジンへ接続）
  const socket = io();

  // join_room を送信する
  // roomId: string, playerName: string
  function joinRoom(roomId, playerName) {
    socket.emit("join_room", { roomId, playerName });
  }

  // room_update を受信したときのコールバックを登録する
  // callback: (roomData) => void
  // roomData: { roomId: string, players: [{ socketId, playerName }] }
  function onRoomUpdate(callback) {
    socket.on("room_update", callback);
  }

  // join_error を受信したときのコールバックを登録する
  // callback: (errorData) => void
  // errorData: { error: string }
  function onJoinError(callback) {
    socket.on("join_error", callback);
  }

  window.MultiplayerAPI = {
    joinRoom,
    onRoomUpdate,
    onJoinError
  };
})();
