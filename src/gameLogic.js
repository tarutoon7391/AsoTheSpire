// バトルの進行を管理する関数群

// 仮の固定値
const PLAYER_HP = 70;
const PLAYER_MAX_HP = 70;
const ENEMY_HP = 50;
const ENEMY_MAX_HP = 50;
const ENEMY_INTENT = "attack";

/**
 * バトルを初期化する。
 * 全プレイヤーと敵のHPを固定値でセットし、フェーズを 'selecting' にする。
 * @param {GameState} gameState
 */
function initBattle(gameState) {
  gameState.players.forEach((player) => {
    player.hp = PLAYER_HP;
    player.maxHp = PLAYER_MAX_HP;
    player.block = 0;
    player.hand = [];
    player.deck = [];
    player.discard = [];
  });

  gameState.enemy = {
    hp: ENEMY_HP,
    maxHp: ENEMY_MAX_HP,
    block: 0,
    intent: ENEMY_INTENT
  };

  gameState.turn = "player";
  gameState.phase = "selecting";
  gameState.selectedCards = new Map();
  gameState.readyPlayers = new Set();
}

/**
 * カード選択フェーズを開始する。
 * phaseを 'selecting' に変更し、選択状態をリセットする。
 * @param {GameState} gameState
 */
function startSelectPhase(gameState) {
  gameState.phase = "selecting";
  gameState.selectedCards = new Map();
  gameState.readyPlayers = new Set();
}

/**
 * プレイヤーがカードを選択する。
 * @param {GameState} gameState
 * @param {string} socketId - 選択したプレイヤーのソケットID
 * @param {string} cardId - 選択したカードのID
 */
function playerSelectCard(gameState, socketId, cardId) {
  if (!gameState.players.has(socketId)) {
    return;
  }
  gameState.selectedCards.set(socketId, cardId);
}

/**
 * プレイヤーが準備完了を宣言する。
 * @param {GameState} gameState
 * @param {string} socketId - 準備完了したプレイヤーのソケットID
 * @returns {boolean} 全員が準備完了かどうか
 */
function playerReady(gameState, socketId) {
  if (!gameState.players.has(socketId)) {
    return false;
  }
  gameState.readyPlayers.add(socketId);
  return gameState.allPlayersReady();
}

module.exports = {
  initBattle,
  startSelectPhase,
  playerSelectCard,
  playerReady
};
