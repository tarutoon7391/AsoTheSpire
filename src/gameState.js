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

    // 報酬カードを選択済みのsocketIdの集合
    this.rewardSelected = new Set();
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
      powers: {},
      // 切断中フラグ：リダイレクト中など一時的に切断したプレイヤーを示す。
      // ゲーム進行中はプレイヤーデータを保持しつつ、準備完了判定などから除外する。
      disconnected: false,
      // anger等で付与した一時的な筋力上昇量。ターン終了時に減算する。
      temporaryStrength: 0
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
    // disconnected フィールド（後方互換のため未定義なら false で補完する）
    if (typeof playerData.disconnected !== "boolean") playerData.disconnected = false;
    // temporaryStrength フィールド（後方互換のため未定義なら 0 で補完する）
    if (typeof playerData.temporaryStrength !== "number") playerData.temporaryStrength = 0;
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
   * 既存プレイヤーのソケットIDを新しいIDに付け替える。
   * リダイレクト後の再接続でsocket.idが変わった場合に使用する。
   * @param {string} oldSocketId - 旧ソケットID
   * @param {string} newSocketId - 新ソケットID
   */
  remapPlayer(oldSocketId, newSocketId) {
    if (!this.players.has(oldSocketId)) {
      return;
    }
    const playerData = this.players.get(oldSocketId);
    // 再接続したので切断フラグを下ろす
    playerData.disconnected = false;
    this.players.delete(oldSocketId);
    this.players.set(newSocketId, playerData);

    if (this.selectedCards.has(oldSocketId)) {
      const card = this.selectedCards.get(oldSocketId);
      this.selectedCards.delete(oldSocketId);
      this.selectedCards.set(newSocketId, card);
    }

    if (this.readyPlayers.has(oldSocketId)) {
      this.readyPlayers.delete(oldSocketId);
      this.readyPlayers.add(newSocketId);
    }

    if (this.rewardSelected.has(oldSocketId)) {
      this.rewardSelected.delete(oldSocketId);
      this.rewardSelected.add(newSocketId);
    }
  }

  /**
   * プレイヤーを切断状態にする。データは保持したまま準備完了判定などから除外する。
   * リダイレクト中の一時的な切断に備えて、ゲーム進行中はremovePlayerではなくこちらを呼ぶ。
   * @param {string} socketId
   */
  markDisconnected(socketId) {
    if (!this.players.has(socketId)) {
      return;
    }
    const playerData = this.players.get(socketId);
    playerData.disconnected = true;
    // 解決待ちの選択・準備状態はクリアしておく（残しておくと進行が止まる可能性があるため）
    this.selectedCards.delete(socketId);
    this.readyPlayers.delete(socketId);
    this.rewardSelected.delete(socketId);
  }

  /**
   * プレイヤーを削除する。関連する選択・準備状態もクリアする。
   * @param {string} socketId - ソケットID
   */
  removePlayer(socketId) {
    this.players.delete(socketId);
    this.selectedCards.delete(socketId);
    this.readyPlayers.delete(socketId);
    this.rewardSelected.delete(socketId);
  }

  /**
   * 接続中の全プレイヤーが準備完了かどうかを返す。
   * 切断中（disconnected）プレイヤーは除外する。
   * 接続中プレイヤーが0人の場合は false を返す。
   * @returns {boolean}
   */
  allPlayersReady() {
    let connectedCount = 0;
    for (const [socketId, playerData] of this.players.entries()) {
      if (playerData.disconnected) {
        continue;
      }
      connectedCount += 1;
      if (!this.readyPlayers.has(socketId)) {
        return false;
      }
    }
    return connectedCount > 0;
  }

  /**
   * 接続中（disconnected=false）のプレイヤー数を返す。
   * @returns {number}
   */
  connectedPlayerCount() {
    let count = 0;
    this.players.forEach((p) => {
      if (!p.disconnected) count += 1;
    });
    return count;
  }

  /**
   * クライアントに送信するためにシリアライズする。
   * Map・Set は配列・オブジェクトに変換する。
   * @returns {object}
   */
  toJSON() {
    const players = {};
    this.players.forEach((playerData, socketId) => {
      // 古いゲーム状態に新フィールドが欠けている場合の互換補完（マイグレーション）
      GameState.migratePlayerData(playerData);
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
        powers: { ...playerData.powers },
        disconnected: playerData.disconnected
      };
    });

    const selectedCards = {};
    this.selectedCards.forEach((cardId, socketId) => {
      selectedCards[socketId] = cardId;
    });

    // 古いゲーム状態に欠けている敵フィールドを補完する（マイグレーション）。
    // status・intent が未定義のままシリアライズされるとクライアント側で
    // undefined を踏んで描画やインテント表示が壊れるため、ここで補完しておく。
    GameState.migrateEnemyData(this.enemy);
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
      totalPlayers: this.players.size,
      // 接続中（disconnected=false）プレイヤー数。待機表示の分母に使う。
      connectedCount: this.connectedPlayerCount()
    };
  }
}

module.exports = GameState;
