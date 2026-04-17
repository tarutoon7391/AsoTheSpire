// ルームごとのゲーム状態を管理するクラス

/**
 * マルチプレイ用のゲーム状態を保持するクラス。
 * バトルに必要なプレイヤー・敵・フェーズ情報をすべて管理する。
 */
class GameState {
  /**
   * @param {string} roomId - このゲーム状態が属するルームID
   */
  constructor(roomId) {
    this.roomId = roomId;

    // socketId => { name, hp, maxHp, block, hand, deck, discard }
    this.players = new Map();

    this.enemy = {
      hp: 0,
      maxHp: 0,
      block: 0,
      intent: null
    };

    // 'player' | 'enemy'
    this.turn = "player";

    // 'waiting' | 'selecting' | 'resolving' | 'enemy_turn' | 'finished'
    this.phase = "waiting";

    // socketId => cardId
    this.selectedCards = new Map();

    // 準備完了したsocketIdの集合
    this.readyPlayers = new Set();
  }

  /**
   * プレイヤーを追加する。すでに存在する場合は何もしない。
   * @param {string} socketId - ソケットID
   * @param {string} name - プレイヤー名
   */
  addPlayer(socketId, name) {
    if (this.players.has(socketId)) {
      return;
    }
    this.players.set(socketId, {
      name,
      hp: 0,
      maxHp: 0,
      block: 0,
      hand: [],
      deck: [],
      discard: []
    });
  }

  /**
   * プレイヤーを削除する。関連する選択・準備状態もクリアする。
   * @param {string} socketId - ソケットID
   */
  removePlayer(socketId) {
    this.players.delete(socketId);
    this.selectedCards.delete(socketId);
    this.readyPlayers.delete(socketId);
  }

  /**
   * 全プレイヤーが準備完了かどうかを返す。
   * プレイヤーが0人の場合は false を返す。
   * @returns {boolean}
   */
  allPlayersReady() {
    if (this.players.size === 0) {
      return false;
    }
    for (const socketId of this.players.keys()) {
      if (!this.readyPlayers.has(socketId)) {
        return false;
      }
    }
    return true;
  }

  /**
   * クライアントに送信するためにシリアライズする。
   * Map・Set は配列・オブジェクトに変換する。
   * @returns {object}
   */
  toJSON() {
    const players = {};
    this.players.forEach((playerData, socketId) => {
      players[socketId] = { ...playerData };
    });

    const selectedCards = {};
    this.selectedCards.forEach((cardId, socketId) => {
      selectedCards[socketId] = cardId;
    });

    return {
      roomId: this.roomId,
      players,
      enemy: { ...this.enemy },
      turn: this.turn,
      phase: this.phase,
      selectedCards,
      readyPlayers: Array.from(this.readyPlayers)
    };
  }
}

module.exports = GameState;
