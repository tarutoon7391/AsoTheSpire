// ステータス定義をまとめる
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
function addStatus(target, statusId, amount, pushLog, targetName) {
  if (!STATUS_DEFINITIONS[statusId] || amount <= 0) {
    return 0;
  }

  if (isDebuff(statusId) && target.status.artifact > 0) {
    target.status.artifact -= 1;
    pushLog(`${targetName}のアーティファクトがデバフを無効化`);
    return 0;
  }

  target.status[statusId] += amount;
  pushLog(`${targetName}に${STATUS_DEFINITIONS[statusId].label}${amount}付与`);
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

// 描画用のステータス配列を返す
function getStatusViewList(status) {
  return Object.keys(STATUS_DEFINITIONS)
    .filter((statusId) => status[statusId] > 0)
    .map((statusId) => ({
      id: statusId,
      label: STATUS_DEFINITIONS[statusId].label,
      value: status[statusId],
      type: STATUS_DEFINITIONS[statusId].type
    }));
}

// ターン終了時の継続効果を順序通り処理する
function applyEndOfTurnStatusEffects(target, targetName, callbacks) {
  const { directDamage, pushLog } = callbacks;
  const status = target.status;

  // 1. 毒ダメージ処理
  if (status.poison > 0) {
    directDamage(target, status.poison);
    pushLog(`${targetName}は毒で${status.poison}ダメージ`);
  }

  // 2. 火傷ダメージ処理
  if (status.burn > 0) {
    const burnDamage = status.burn * 5;
    directDamage(target, burnDamage);
    pushLog(`${targetName}は火傷で${burnDamage}ダメージ`);
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

window.STATUS_DEFINITIONS = STATUS_DEFINITIONS;
window.createStatusState = createStatusState;
window.addStatus = addStatus;
window.calculateModifiedDamage = calculateModifiedDamage;
window.calculateModifiedBlock = calculateModifiedBlock;
window.getStatusViewList = getStatusViewList;
window.applyEndOfTurnStatusEffects = applyEndOfTurnStatusEffects;
