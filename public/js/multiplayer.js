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

  // game_state_update を受信したときにコンソールへ表示する
  socket.on("game_state_update", function (gameState) {
    console.log("[game_state_update]", JSON.stringify(gameState, null, 2));
  });

  // battle_start を送信する
  // roomId: string
  function sendBattleStart(roomId) {
    socket.emit("battle_start", { roomId });
  }

  // select_card を送信する
  // roomId: string, cardId: string
  function sendSelectCard(roomId, cardId) {
    socket.emit("select_card", { roomId, cardId });
  }

  // player_ready を送信する
  // roomId: string
  function sendPlayerReady(roomId) {
    socket.emit("player_ready", { roomId });
  }

  window.MultiplayerAPI = {
    joinRoom,
    onRoomUpdate,
    onJoinError,
    sendBattleStart,
    sendSelectCard,
    sendPlayerReady
  };
})();
