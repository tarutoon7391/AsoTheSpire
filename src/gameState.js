// ルームごとのゲーム状態を管理するクラス

const { createStatusState } = require("./status");
const { createStarterDeckIds } = require("./cards");

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

    // socketId => { name, hp, maxHp, block, hand, deck, discard, energy, maxEnergy, status, damageTakenThisTurn, powers }
    this.players = new Map();

    this.enemy = {
      hp: 0,
      maxHp: 0,
      block: 0,
      intent: { type: "attack", value: 10 },
      status: createStatusState()
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
      deck: createStarterDeckIds(),
      discard: [],
      energy: 3,
      maxEnergy: 3,
      status: createStatusState(),
      damageTakenThisTurn: 0,
      powers: {}
    });
  }

  /**
   * 古いセーブデータとの互換性を保つためのマイグレーション処理。
   * 新しく追加されたフィールドが存在しない場合はデフォルト値で補完する。
   * @param {object} playerData - マイグレーション対象のプレイヤーデータ
   * @returns {object} マイグレーション済みのプレイヤーデータ
   */
  static migratePlayerData(playerData) {
    if (!Array.isArray(playerData.hand)) playerData.hand = [];
    if (!Array.isArray(playerData.deck)) playerData.deck = createStarterDeckIds();
    if (!Array.isArray(playerData.discard)) playerData.discard = [];
    if (playerData.energy === undefined) playerData.energy = 3;
    if (playerData.maxEnergy === undefined) playerData.maxEnergy = 3;
    if (!playerData.status || typeof playerData.status !== "object") {
      playerData.status = createStatusState();
    } else {
      // 個別フィールドが欠けている場合もデフォルト値で補完する
      const defaults = createStatusState();
      for (const key of Object.keys(defaults)) {
        if (playerData.status[key] === undefined) {
          playerData.status[key] = defaults[key];
        }
      }
    }
    if (playerData.damageTakenThisTurn === undefined) playerData.damageTakenThisTurn = 0;
    if (!playerData.powers || typeof playerData.powers !== "object") {
      playerData.powers = {};
    }
    return playerData;
  }

  /**
   * 敵データに欠けているフィールドをデフォルト値で補完する。
   * @param {object} enemyData - マイグレーション対象の敵データ
   * @returns {object} マイグレーション済みの敵データ
   */
  static migrateEnemyData(enemyData) {
    if (!enemyData.status || typeof enemyData.status !== "object") {
      enemyData.status = createStatusState();
    } else {
      const defaults = createStatusState();
      for (const key of Object.keys(defaults)) {
        if (enemyData.status[key] === undefined) {
          enemyData.status[key] = defaults[key];
        }
      }
    }
    if (!enemyData.intent || typeof enemyData.intent !== "object") {
      enemyData.intent = { type: "attack", value: 10 };
    }
    return enemyData;
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
      players[socketId] = {
        name: playerData.name,
        hp: playerData.hp,
        maxHp: playerData.maxHp,
        block: playerData.block,
        hand: [...playerData.hand],
        deckCount: playerData.deck.length,
        discardCount: playerData.discard.length,
        energy: playerData.energy,
        maxEnergy: playerData.maxEnergy,
        status: { ...playerData.status },
        damageTakenThisTurn: playerData.damageTakenThisTurn,
        powers: { ...playerData.powers }
      };
    });

    const selectedCards = {};
    this.selectedCards.forEach((cardId, socketId) => {
      selectedCards[socketId] = cardId;
    });

    const enemy = this.enemy;

    return {
      roomId: this.roomId,
      players,
      enemy: {
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        block: enemy.block,
        intent: { ...enemy.intent },
        status: { ...enemy.status }
      },
      turn: this.turn,
      phase: this.phase,
      selectedCards,
      readyPlayers: Array.from(this.readyPlayers),
      readyCount: this.readyPlayers.size,
      totalPlayers: this.players.size
    };
  }
}

module.exports = GameState;
