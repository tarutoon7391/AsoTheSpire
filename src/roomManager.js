// ルームの作成・参加・削除・取得を管理するクラス

const MAX_PLAYERS_PER_ROOM = 4;

class RoomManager {
  constructor() {
    // roomId => { players: [{ socketId, playerName }] }
    this.rooms = new Map();
  }

  // ルームに参加する（存在しない場合は新規作成）
  // 戻り値: { success: boolean, room: object|null, error: string|null }
  joinRoom(roomId, socketId, playerName) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, { players: [] });
    }

    const room = this.rooms.get(roomId);

    if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
      return { success: false, room: null, error: "ルームが満員です（最大4人）" };
    }

    // 同一ソケットが重複参加しないようにする
    if (room.players.some((p) => p.socketId === socketId)) {
      return { success: false, room: null, error: "すでに参加済みです" };
    }

    room.players.push({ socketId, playerName });
    return { success: true, room: this.getRoomView(roomId), error: null };
  }

  // ソケットIDに紐づくプレイヤーをすべてのルームから削除する
  // 戻り値: 影響を受けたルームIDの配列
  removeSocket(socketId) {
    const affectedRoomIds = [];

    this.rooms.forEach((room, roomId) => {
      const before = room.players.length;
      room.players = room.players.filter((p) => p.socketId !== socketId);
      if (room.players.length !== before) {
        affectedRoomIds.push(roomId);
      }

      // プレイヤーが0人になったルームは削除する
      if (room.players.length === 0) {
        this.rooms.delete(roomId);
      }
    });

    return affectedRoomIds;
  }

  // ルームの表示用データを返す
  getRoomView(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }
    return {
      roomId,
      players: room.players.map((p) => ({ socketId: p.socketId, playerName: p.playerName }))
    };
  }

  // ルームが存在するかどうかを返す
  hasRoom(roomId) {
    return this.rooms.has(roomId);
  }
}

module.exports = RoomManager;
