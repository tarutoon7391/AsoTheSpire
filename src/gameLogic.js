// バトルの進行を管理する関数群

const { CARD_LIBRARY, CARD_UPGRADE_LIBRARY, createStarterDeckIds } = require("./cards");
const {
  createStatusState,
  addStatus,
  calculateModifiedDamage,
  calculateModifiedBlock,
  applyEndOfTurnStatusEffects
} = require("./status");

// 固定値
const PLAYER_HP = 70;
const PLAYER_MAX_HP = 70;
const ENEMY_HP = 50;
const ENEMY_MAX_HP = 50;

/**
 * 配列をフィッシャー–イェーツシャッフルでランダムに並び替える（破壊的）。
 * @param {Array} array
 * @returns {Array}
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * プレイヤーの山札からcount枚を手札に移動する。
 * 山札が足りない場合は捨て札をシャッフルして山札に補充してから継続する。
 * @param {object} player
 * @param {number} count
 */
function drawCards(player, count) {
  for (let i = 0; i < count; i++) {
    if (player.deck.length === 0) {
      if (player.discard.length === 0) {
        // 山札も捨て札もない場合はドロー終了
        break;
      }
      // 捨て札をシャッフルして山札に補充する
      player.deck = shuffleArray([...player.discard]);
      player.discard = [];
    }
    player.hand.push(player.deck.shift());
  }
}

/**
 * ブロックを考慮して対象にダメージを与える。
 * 残ったダメージは damageTakenThisTurn に加算する。
 * @param {object} target - ダメージを受けるオブジェクト（hp・block を持つ）
 * @param {number} damage - 適用するダメージ量
 * @param {boolean} [trackDamageTaken=false] - damageTakenThisTurn を更新するか
 */
function applyDamageToTarget(target, damage, trackDamageTaken) {
  const blocked = Math.min(target.block, damage);
  target.block -= blocked;
  const actualDamage = damage - blocked;
  target.hp = Math.max(0, target.hp - actualDamage);
  if (trackDamageTaken && actualDamage > 0) {
    target.damageTakenThisTurn = (target.damageTakenThisTurn || 0) + actualDamage;
  }
}

/**
 * カードID（文字列）とupgradedフラグからカード効果オブジェクトを取得する。
 * upgraded=true の場合は CARD_UPGRADE_LIBRARY の effect で上書きする。
 * @param {string} cardId
 * @param {boolean} upgraded
 * @returns {{ cardDef: object, effect: object }}
 */
function resolveCardEffect(cardId, upgraded) {
  const cardDef = CARD_LIBRARY[cardId];
  if (!cardDef) {
    return null;
  }
  let effect = { ...cardDef.effect };
  if (upgraded && CARD_UPGRADE_LIBRARY[cardId]) {
    effect = { ...CARD_UPGRADE_LIBRARY[cardId].effect };
  }
  return { cardDef, effect };
}

/**
 * バトルを初期化する。
 * 全プレイヤーと敵のHPを固定値でセットし、各プレイヤーのデッキをシャッフルして
 * 5枚ドローし、フェーズを 'selecting' にする。
 * @param {GameState} gameState
 */
function initBattle(gameState) {
  gameState.players.forEach((player) => {
    player.hp = PLAYER_HP;
    player.maxHp = PLAYER_MAX_HP;
    player.block = 0;
    player.energy = player.maxEnergy || 3;
    player.hand = [];
    player.discard = [];
    player.damageTakenThisTurn = 0;
    player.powers = {};
    player.temporaryStrength = 0;
    // statusが未初期化の場合はデフォルト値で補完する
    if (!player.status || typeof player.status !== "object") {
      player.status = createStatusState();
    } else {
      // 既存statusの数値フィールドをリセットする（前バトルの残存を防ぐ）
      const fresh = createStatusState();
      for (const key of Object.keys(fresh)) {
        player.status[key] = fresh[key];
      }
    }
    // デッキが空の場合はスターターデッキを補充する
    if (!Array.isArray(player.deck) || player.deck.length === 0) {
      player.deck = createStarterDeckIds();
    }
    shuffleArray(player.deck);
    drawCards(player, 5);
  });

  gameState.enemy = {
    hp: ENEMY_HP,
    maxHp: ENEMY_MAX_HP,
    block: 0,
    intent: { type: "attack", value: 10 },
    status: createStatusState()
  };

  gameState.turn = "player";
  gameState.phase = "selecting";
  gameState.selectedCards = new Map();
  gameState.readyPlayers = new Set();
  gameState.rewardSelected = new Set();
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
 * プレイヤーがカードを使用する（サーバー権威の即時処理）。
 *
 * 以下のバリデーションをすべて満たした場合のみ効果を適用する：
 *   - フェーズが 'selecting' であること
 *   - 該当socketIdのプレイヤーが存在し、切断中でないこと
 *   - 指定カードIDが手札に存在すること
 *   - エネルギーがコスト以上であること
 *
 * バリデーション通過時は、エネルギー消費・手札からの削除・効果適用・捨て札追加までを
 * すべて行い、敵HPが0以下になればフェーズを 'finished' に変更する。
 *
 * @param {GameState} gameState
 * @param {string} socketId - カードを使用するプレイヤーのソケットID
 * @param {string} cardId - 使用するカードのID
 * @returns {{ success: boolean, reason?: string, enemyDefeated?: boolean }}
 */
function playerSelectCard(gameState, socketId, cardId) {
  // フェーズチェック：selecting 以外では使用不可（ターン終了後の使用を防ぐ）
  if (gameState.phase !== "selecting") {
    return { success: false, reason: "not_selecting_phase" };
  }
  if (!gameState.players.has(socketId)) {
    return { success: false, reason: "player_not_found" };
  }
  const player = gameState.players.get(socketId);
  if (player.disconnected) {
    return { success: false, reason: "player_disconnected" };
  }
  // 既にターン終了を宣言したプレイヤーは使用不可
  if (gameState.readyPlayers.has(socketId)) {
    return { success: false, reason: "already_ended_turn" };
  }
  // 手札所持チェック
  const handIndex = player.hand.indexOf(cardId);
  if (handIndex === -1) {
    return { success: false, reason: "card_not_in_hand" };
  }
  const cardDef = CARD_LIBRARY[cardId];
  if (!cardDef) {
    return { success: false, reason: "unknown_card" };
  }
  // エネルギーチェック
  const cost = typeof cardDef.cost === "number" ? cardDef.cost : 0;
  if ((player.energy || 0) < cost) {
    return { success: false, reason: "not_enough_energy" };
  }

  // --- ここから状態変更 ---
  // エネルギー消費
  player.energy = Math.max(0, player.energy - cost);
  // 手札から削除
  player.hand.splice(handIndex, 1);

  // カード効果を適用する
  applyCardEffects(gameState, player, socketId, cardId, false);

  // 捨て札に追加する
  player.discard.push(cardId);

  // 互換性のために最後に使用したカードを selectedCards に記録する
  gameState.selectedCards.set(socketId, cardId);

  // 敵HP判定
  const enemyDefeated = gameState.enemy.hp <= 0;
  if (enemyDefeated) {
    gameState.phase = "finished";
    // 全員のreadyとカード選択をクリアする（次ステップへスムーズに遷移するため）
    gameState.readyPlayers = new Set();
  }

  return { success: true, enemyDefeated };
}

/**
 * カード効果（ダメージ・ブロック・ドロー・ステータス・パワー等）を player と enemy に適用する。
 * 手札からの削除・捨て札追加・エネルギー消費は呼び出し側で行うこと。
 *
 * @param {GameState} gameState
 * @param {object} player - 使用プレイヤーのデータ
 * @param {string} socketId - 使用プレイヤーのソケットID（一時筋力の追跡用）
 * @param {string} cardId - 使用するカードID
 * @param {boolean} upgraded - アップグレード済みかどうか
 */
function applyCardEffects(gameState, player, socketId, cardId, upgraded) {
  const resolved = resolveCardEffect(cardId, upgraded);
  if (!resolved) {
    return;
  }
  const { effect } = resolved;
  const enemy = gameState.enemy;

  // --- 単純ダメージ ---
  if (effect.damage !== undefined) {
    const dmg = calculateModifiedDamage(effect.damage, player.status, enemy.status);
    applyDamageToTarget(enemy, dmg, false);
  }

  // --- マルチヒットダメージ ---
  if (Array.isArray(effect.multiDamage)) {
    effect.multiDamage.forEach((baseDmg) => {
      const dmg = calculateModifiedDamage(baseDmg, player.status, enemy.status);
      applyDamageToTarget(enemy, dmg, false);
    });
  }

  // --- ブロック ---
  if (effect.block !== undefined) {
    const blockAmount = calculateModifiedBlock(effect.block, player.status);
    player.block += blockAmount;
  }

  // --- エネルギー回復 ---
  if (effect.energy !== undefined) {
    player.energy = (player.energy || 0) + effect.energy;
  }

  // --- ドロー ---
  if (effect.draw !== undefined) {
    drawCards(player, effect.draw);
  }

  // --- damageTakenThisTurn×倍率ダメージ ---
  if (effect.damageFromTakenMultiplier !== undefined) {
    const baseDmg = (player.damageTakenThisTurn || 0) * effect.damageFromTakenMultiplier;
    const dmg = calculateModifiedDamage(baseDmg, player.status, enemy.status);
    applyDamageToTarget(enemy, dmg, false);
  }

  // --- immolate: 手札全廃棄して廃棄枚数×倍率ダメージ ---
  if (effect.damagePerExhaustedHand !== undefined) {
    const exhaustedCount = player.hand.length;
    player.discard.push(...player.hand);
    player.hand = [];
    const baseDmg = exhaustedCount * effect.damagePerExhaustedHand;
    const dmg = calculateModifiedDamage(baseDmg, player.status, enemy.status);
    applyDamageToTarget(enemy, dmg, false);
  }

  // --- offering: 手札1枚廃棄 ---
  if (effect.exhaustOneFromHand) {
    if (player.hand.length > 0) {
      // 先頭のカードを廃棄する
      player.discard.push(player.hand.shift());
    }
  }

  // --- secondWind: 手札の非攻撃カードを全廃棄してブロック獲得 ---
  if (effect.exhaustNonAttackAndGainBlock !== undefined) {
    const attackCards = [];
    const nonAttackCards = [];
    player.hand.forEach((hCardId) => {
      const def = CARD_LIBRARY[hCardId];
      if (def && def.type === "攻撃") {
        attackCards.push(hCardId);
      } else {
        nonAttackCards.push(hCardId);
      }
    });
    player.hand = attackCards;
    player.discard.push(...nonAttackCards);
    const blockGain = nonAttackCards.length * effect.exhaustNonAttackAndGainBlock;
    const blockAmount = calculateModifiedBlock(blockGain, player.status);
    player.block += blockAmount;
  }

  // --- 一時的な筋力上昇（anger）---
  // ターン終了時に減算するため、累積量を temporaryStrength に保持する
  if (effect.temporaryStrength !== undefined) {
    addStatus(player, "strength", effect.temporaryStrength);
    player.temporaryStrength = (player.temporaryStrength || 0) + effect.temporaryStrength;
  }

  // --- 敵へのステータス付与 ---
  if (effect.applyStatusToEnemy) {
    Object.entries(effect.applyStatusToEnemy).forEach(([statusId, amount]) => {
      addStatus(enemy, statusId, amount);
    });
  }

  // --- 自分へのステータス付与 ---
  if (effect.applyStatusToSelf) {
    Object.entries(effect.applyStatusToSelf).forEach(([statusId, amount]) => {
      addStatus(player, statusId, amount);
    });
  }

  // --- パワーカード ---
  if (effect.grantPower) {
    player.powers[effect.grantPower] = true;
  }
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

/**
 * 全プレイヤーのターン終了処理を行う。
 *
 * カード使用は select_card 受信時に即時処理されるため、ここではカード解決は行わない。
 * 以下の処理のみ実行する：
 *   - 各プレイヤーの継続ステータス効果適用（毒・火傷・スタック減少など）
 *   - anger等で付与した一時筋力の解除
 *   - damageTakenThisTurn のリセット
 *   - 残り手札を捨て札へ移動
 *   - 敵の継続ステータス効果適用
 *
 * 処理後に selectedCards・readyPlayers をリセットし、
 * 敵HPが0以下なら phase を 'finished'、そうでなければ 'enemy_turn' に変更する。
 *
 * @param {GameState} gameState
 */
function resolveCards(gameState) {
  // --- 各プレイヤーのターン終了処理 ---
  gameState.players.forEach((player) => {
    // 切断中プレイヤーもステータス効果を適用しておく（再接続時に整合させるため）
    // 継続ステータス効果（毒・火傷・スタック減少）
    applyEndOfTurnStatusEffects(player);

    // anger等の一時筋力をターン終了時に減算する
    if ((player.temporaryStrength || 0) > 0) {
      player.status.strength = Math.max(0, player.status.strength - player.temporaryStrength);
      player.temporaryStrength = 0;
    }

    // このターン受けたダメージをリセット
    player.damageTakenThisTurn = 0;

    // 手札を捨て札に移動（ドロー・エネルギー・ブロックリセットはenemyAttackで行う）
    player.discard.push(...player.hand);
    player.hand = [];
  });

  // 敵のターン終了処理（ステータス効果のみ。ブロックリセットはenemyAttack先頭で行う）
  applyEndOfTurnStatusEffects(gameState.enemy);

  // 選択状態と準備状態をリセットする
  gameState.selectedCards = new Map();
  gameState.readyPlayers = new Set();

  // 敵のHPが0以下なら終了フェーズへ、そうでなければ敵のターンへ
  if (gameState.enemy.hp <= 0) {
    gameState.phase = "finished";
  } else {
    gameState.phase = "enemy_turn";
  }
}

/**
 * 敵が全プレイヤーを攻撃し、次のインテントをランダムに設定する。
 * 攻撃後にターン開始処理（ブロックリセット・エネルギーリセット・ドロー）を行い
 * phase を 'selecting' に戻す。全プレイヤーのHPが0以下なら 'finished' にする。
 * @param {GameState} gameState
 */
function enemyAttack(gameState) {
  const enemy = gameState.enemy;

  // 前ターンの敵ブロックをリセットする（敵ターン開始時に消える）
  if (!enemy.powers || !enemy.powers.barricade) {
    enemy.block = 0;
  }

  // intentに応じた敵行動を実行する
  if (enemy.intent) {
    if (enemy.intent.type === "attack") {
      gameState.players.forEach((player) => {
        // 切断中プレイヤーは攻撃対象から除外する
        if (player.disconnected) return;
        const dmg = calculateModifiedDamage(enemy.intent.value, enemy.status, player.status);
        applyDamageToTarget(player, dmg, true);
      });
    } else if (enemy.intent.type === "block") {
      // 敵がブロック行動をとる場合はブロック値を加算する
      enemy.block += enemy.intent.value;
    }
  }

  // 次のインテントをランダムに設定する（50%ずつ attack/block）
  if (Math.random() < 0.5) {
    const value = Math.floor(Math.random() * 6) + 10; // 10〜15
    enemy.intent = { type: "attack", value };
  } else {
    const value = Math.floor(Math.random() * 5) + 8; // 8〜12
    enemy.intent = { type: "block", value };
  }

  // 各プレイヤーのターン開始処理
  gameState.players.forEach((player) => {
    // ブロックリセット（barricadeがない場合）
    if (!player.powers || !player.powers.barricade) {
      player.block = 0;
    }
    // エネルギーリセット
    player.energy = player.maxEnergy || 3;
    // このターン受けたダメージをリセット
    player.damageTakenThisTurn = 0;
    // 5枚ドロー（resolveCardsで手札は捨て札に移動済みのため空になっている）
    drawCards(player, 5);
    // demonFormによるターン開始時の筋力上昇
    if (player.powers && player.powers.demonForm) {
      addStatus(player, "strength", 2);
    }
  });

  // 選択状態と準備状態をリセットする
  gameState.selectedCards = new Map();
  gameState.readyPlayers = new Set();

  // 全プレイヤーのHPが0以下なら終了フェーズへ、そうでなければ次のターンへ
  // 切断中プレイヤーはHP判定から除外する（接続中プレイヤーが全員死亡した場合のみ敗北）
  const connectedPlayers = Array.from(gameState.players.values()).filter((p) => !p.disconnected);
  const allDead = connectedPlayers.length > 0 && connectedPlayers.every((p) => p.hp <= 0);
  if (allDead) {
    gameState.phase = "finished";
  } else {
    gameState.phase = "selecting";
  }
}

/**
 * （後方互換のためのスタブ）以前は select_card 受信時にダメージのみ即時反映していたが、
 * 現在は playerSelectCard が即時にカード効果をすべて適用するため不要になった。
 * 外部から呼ばれる場合に備えて何もしない関数として残す。
 * @deprecated playerSelectCard で全効果が即時適用されるためこの関数は不要
 */
function applyCardToEnemy() {
  // no-op
}

module.exports = {
  PLAYER_HP,
  PLAYER_MAX_HP,
  INITIAL_HAND_SIZE: 5,
  initBattle,
  startSelectPhase,
  playerSelectCard,
  playerReady,
  resolveCards,
  enemyAttack,
  applyCardToEnemy,
  drawCards,
  shuffleArray
};
