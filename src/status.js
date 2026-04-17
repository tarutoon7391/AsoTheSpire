// ステータス処理（サーバー側Node.js用）
// public/js/status.js から必要な関数を移植。
// window.xxx の代わりに module.exports で公開する。

const STATUS_DEFINITIONS = {
  strength: { label: "筋力", type: "buff" },
  dexterity: { label: "敏捷", type: "buff" },
  artifact: { label: "アーティファクト", type: "buff" },
  vulnerable: { label: "脆弱", type: "debuff" },
  weak: { label: "脱力", type: "debuff" },
  poison: { label: "毒", type: "debuff" },
  burn: { label: "火傷", type: "debuff" },
  restrained: { label: "拘束", type: "debuff" }
};

// ステータス初期値を作る
function createStatusState() {
  return {
    strength: 0,
    dexterity: 0,
    artifact: 0,
    vulnerable: 0,
    weak: 0,
    poison: 0,
    burn: 0,
    restrained: 0
  };
}

// デバフかどうかを判定する
function isDebuff(statusId) {
  return STATUS_DEFINITIONS[statusId] && STATUS_DEFINITIONS[statusId].type === "debuff";
}

// ステータスを付与する（デバフはアーティファクトで無効化される）
// pushLog・targetName は省略可能（省略時はログ出力しない）
function addStatus(target, statusId, amount, pushLog, targetName) {
  if (!STATUS_DEFINITIONS[statusId] || amount <= 0) {
    return 0;
  }

  if (isDebuff(statusId) && target.status.artifact > 0) {
    target.status.artifact -= 1;
    if (pushLog && targetName) {
      pushLog(`${targetName}のアーティファクトがデバフを無効化`);
    }
    return 0;
  }

  target.status[statusId] += amount;
  if (pushLog && targetName) {
    pushLog(`${targetName}に${STATUS_DEFINITIONS[statusId].label}${amount}付与`);
  }
  return amount;
}

// 攻撃ダメージにステータス補正を適用する
function calculateModifiedDamage(baseDamage, attackerStatus, defenderStatus) {
  let modified = baseDamage;

  modified += attackerStatus.strength;
  if (attackerStatus.weak > 0) {
    modified = Math.floor(modified * 0.75);
  }

  if (defenderStatus.vulnerable > 0) {
    modified = Math.floor(modified * 1.5);
  }

  return Math.max(0, modified);
}

// ブロック値に敏捷補正を適用する
function calculateModifiedBlock(baseBlock, status) {
  return Math.max(0, baseBlock + status.dexterity);
}

// ターン終了時の継続効果を順序通り処理する
// callbacks引数は省略可能
function applyEndOfTurnStatusEffects(target, targetName, callbacks) {
  const pushLog = callbacks && callbacks.pushLog ? callbacks.pushLog : () => {};
  const directDamage =
    callbacks && callbacks.directDamage
      ? callbacks.directDamage
      : (t, dmg) => {
          // ブロックを削ってからHPに適用する
          const blocked = Math.min(t.block, dmg);
          t.block -= blocked;
          t.hp = Math.max(0, t.hp - (dmg - blocked));
        };

  const status = target.status;
  const name = targetName || "";

  // 1. 毒ダメージ処理
  if (status.poison > 0) {
    directDamage(target, status.poison);
    pushLog(`${name}は毒で${status.poison}ダメージ`);
  }

  // 2. 火傷ダメージ処理
  if (status.burn > 0) {
    const burnDamage = status.burn * 5;
    directDamage(target, burnDamage);
    pushLog(`${name}は火傷で${burnDamage}ダメージ`);
  }

  // 3. 脆弱・脱力のスタック減少
  if (status.vulnerable > 0) {
    status.vulnerable -= 1;
  }
  if (status.weak > 0) {
    status.weak -= 1;
  }

  // 4. 毒のスタック減少
  if (status.poison > 0) {
    status.poison -= 1;
  }
}

module.exports = {
  STATUS_DEFINITIONS,
  createStatusState,
  isDebuff,
  addStatus,
  calculateModifiedDamage,
  calculateModifiedBlock,
  applyEndOfTurnStatusEffects
};
