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
    // statusが未初期化の場合はデフォルト値で補完する
    if (!player.status || typeof player.status !== "object") {
      player.status = createStatusState();
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

/**
 * 全プレイヤーの選択カードを順番に処理し、結果をゲーム状態に反映する。
 * 全カード効果に対応し、ターン終了処理も行う。
 * 処理後に selectedCards・readyPlayers をリセットし、
 * phase を 'enemy_turn' または（敵HP0以下なら）'finished' に変更する。
 * @param {GameState} gameState
 */
function resolveCards(gameState) {
  // angerによる一時筋力フラグを追跡する（socketId => temporaryStrengthAmount）
  const angerUsed = new Map();

  gameState.selectedCards.forEach((cardEntry, socketId) => {
    const player = gameState.players.get(socketId);
    if (!player) {
      return;
    }

    // cardEntry は文字列のカードID、またはオブジェクト { id, upgraded } でも受け付ける
    let cardId, upgraded;
    if (typeof cardEntry === "object" && cardEntry !== null) {
      cardId = cardEntry.id;
      upgraded = cardEntry.upgraded || false;
    } else {
      cardId = String(cardEntry);
      upgraded = false;
    }

    const resolved = resolveCardEffect(cardId, upgraded);
    if (!resolved) {
      // 未定義カードは何もしない
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
    if (effect.temporaryStrength !== undefined) {
      addStatus(player, "strength", effect.temporaryStrength);
      angerUsed.set(socketId, effect.temporaryStrength);
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
  });

  // --- ターン終了処理 ---

  // 各プレイヤーのターン終了処理
  gameState.players.forEach((player, socketId) => {
    // 継続ステータス効果（毒・火傷・スタック減少）
    applyEndOfTurnStatusEffects(player);

    // barricadeを持たないプレイヤーのブロックをリセット
    if (!player.powers.barricade) {
      player.block = 0;
    }

    // demonFormによるターン開始時の筋力上昇（次のターン開始扱いで適用）
    if (player.powers.demonForm) {
      addStatus(player, "strength", 2);
    }

    // angerの一時筋力をターン終了時に減少させる
    if (angerUsed.has(socketId)) {
      player.status.strength = Math.max(0, player.status.strength - angerUsed.get(socketId));
    }

    // このターン受けたダメージをリセット
    player.damageTakenThisTurn = 0;

    // 手札を捨て札に移動
    player.discard.push(...player.hand);
    player.hand = [];

    // 次のターンのために5枚ドロー
    drawCards(player, 5);

    // エネルギーをリセット
    player.energy = player.maxEnergy || 3;
  });

  // 敵のターン終了処理
  applyEndOfTurnStatusEffects(gameState.enemy);
  // バグ④修正: 敵のブロックは「次の敵ターン開始時（enemyAttack 先頭）」にリセットするため、
  // ここではリセットしない。プレイヤーターン中は敵のブロックを維持する。

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

  // バグ④修正: 敵のブロックリセットを enemyAttack() の先頭に移動する。
  // 「敵がブロックする → プレイヤーターン中は敵ブロック維持
  //   → 次の敵ターン開始時にブロックリセット → 攻撃」の順にすることで、
  // プレイヤーのターン中に敵のブロックが消えてしまう不具合を防ぐ。
  if (!enemy.powers || !enemy.powers.barricade) {
    enemy.block = 0;
  }

  if (enemy.intent && enemy.intent.type === "attack") {
    gameState.players.forEach((player) => {
      const dmg = calculateModifiedDamage(enemy.intent.value, enemy.status, player.status);
      applyDamageToTarget(player, dmg, true);
    });
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
    // 手札を捨て札に移動して5枚ドロー
    player.discard.push(...player.hand);
    player.hand = [];
    drawCards(player, 5);
  });

  // 選択状態と準備状態をリセットする
  gameState.selectedCards = new Map();
  gameState.readyPlayers = new Set();

  // 全プレイヤーのHPが0以下なら終了フェーズへ、そうでなければ次のターンへ
  const allDead = Array.from(gameState.players.values()).every((p) => p.hp <= 0);
  if (allDead) {
    gameState.phase = "finished";
  } else {
    gameState.phase = "selecting";
  }
}

/**
 * カードが選択された時点で、敵へのダメージとステータス付与を即時計算して反映する。
 * ブロック・ドロー・エネルギー回復・自己ステータス付与・パワー付与等は処理しない
 * （これらは resolveCards でまとめて処理する）。
 * 敵HPが0以下になってもフェーズを変更しない（フェーズ管理は resolveCards に任せる）。
 * @param {GameState} gameState
 * @param {string} socketId - カードを選択したプレイヤーのソケットID
 */
function applyCardToEnemy(gameState, socketId) {
  const player = gameState.players.get(socketId);
  if (!player) {
    return;
  }

  const cardEntry = gameState.selectedCards.get(socketId);
  if (!cardEntry) {
    return;
  }

  let cardId, upgraded;
  if (typeof cardEntry === "object" && cardEntry !== null) {
    cardId = cardEntry.id;
    upgraded = cardEntry.upgraded || false;
  } else {
    cardId = String(cardEntry);
    upgraded = false;
  }

  const resolved = resolveCardEffect(cardId, upgraded);
  if (!resolved) {
    return;
  }

  const { effect } = resolved;
  const enemy = gameState.enemy;

  // --- 単純ダメージ（第3引数falseはdamageTakenThisTurnを更新しないことを示す）---
  if (effect.damage !== undefined) {
    const dmg = calculateModifiedDamage(effect.damage, player.status, enemy.status);
    applyDamageToTarget(enemy, dmg, false);
  }

  // --- マルチヒットダメージ（第3引数falseはdamageTakenThisTurnを更新しないことを示す）---
  if (Array.isArray(effect.multiDamage)) {
    effect.multiDamage.forEach((baseDmg) => {
      const dmg = calculateModifiedDamage(baseDmg, player.status, enemy.status);
      applyDamageToTarget(enemy, dmg, false);
    });
  }

  // --- damageTakenThisTurn×倍率ダメージ（第3引数falseはdamageTakenThisTurnを更新しないことを示す）---
  if (effect.damageFromTakenMultiplier !== undefined) {
    const baseDmg = (player.damageTakenThisTurn || 0) * effect.damageFromTakenMultiplier;
    const dmg = calculateModifiedDamage(baseDmg, player.status, enemy.status);
    applyDamageToTarget(enemy, dmg, false);
  }

  // --- 手札全廃棄×倍率ダメージ（第3引数falseはdamageTakenThisTurnを更新しないことを示す）---
  if (effect.damagePerExhaustedHand !== undefined) {
    const exhaustedCount = player.hand.length;
    const baseDmg = exhaustedCount * effect.damagePerExhaustedHand;
    const dmg = calculateModifiedDamage(baseDmg, player.status, enemy.status);
    applyDamageToTarget(enemy, dmg, false);
  }

  // --- 敵へのステータス付与 ---
  if (effect.applyStatusToEnemy) {
    Object.entries(effect.applyStatusToEnemy).forEach(([statusId, amount]) => {
      addStatus(enemy, statusId, amount);
    });
  }
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
