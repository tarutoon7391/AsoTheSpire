const { shuffle, randomInt } = window.STSUtils;

// ブロック込みでダメージを与える
function applyBlockedDamage(target, amount) {
  const blocked = Math.min(target.block, amount);
  const remainingDamage = amount - blocked;
  target.block -= blocked;
  target.hp = Math.max(0, target.hp - remainingDamage);
  return { blocked, dealt: remainingDamage };
}

// 直接ダメージを与える（ブロックを無視）
function applyDirectDamage(target, amount) {
  const damage = Math.max(0, amount);
  target.hp = Math.max(0, target.hp - damage);
  return damage;
}

const gameState = {
  isDefeated: false,
  inReward: false,
  isAnimating: false,
  flow: {
    isBossBattle: false,
    roomNumber: 1,
    onBattleWin: null,
    onBattleLose: null,
    onRewardResolved: null
  },
  drag: {
    active: false,
    handIndex: -1,
    cardId: "",
    pointerId: null,
    pointerX: 0,
    pointerY: 0,
    element: null
  },
  currentPhase: "player",
  turn: 1,
  rewardChoices: [],
  enemyIntentVersion: 0,
  renderedEnemyIntentVersion: -1,
  lastIntentDisplayHtml: "",
  player: {
    maxHp: 80,
    hp: 80,
    maxEnergy: 3,
    energy: 3,
    block: 0,
    status: window.createStatusState(),
    powers: {
      demonForm: false,
      demonFormStrength: 2,
      feed: false,
      feedHeal: 3,
      barricade: false
    },
    masterDeck: [],
    drawPile: [],
    discardPile: [],
    hand: [],
    exhaustPile: [],
    noDrawThisTurn: false,
    turnLocked: false,
    damageTakenThisTurn: 0,
    temporaryStrengthLoss: 0
  },
  enemy: {
    maxHp: 50,
    hp: 50,
    block: 0,
    status: window.createStatusState(),
    intent: null
  }
};

// カードエントリを標準化する
function normalizeCardEntry(cardEntry) {
  if (typeof cardEntry === "string") {
    return window.createCardInstance(cardEntry, false);
  }
  return {
    id: cardEntry.id,
    upgraded: Boolean(cardEntry.upgraded)
  };
}

// カードエントリを複製する
function cloneCardEntry(cardEntry) {
  const normalized = normalizeCardEntry(cardEntry);
  return {
    id: normalized.id,
    upgraded: normalized.upgraded
  };
}

// カードエントリからカードIDを取得する
function getCardId(cardEntry) {
  return normalizeCardEntry(cardEntry).id;
}

// カードエントリが強化済みか判定する
function isCardUpgraded(cardEntry) {
  return normalizeCardEntry(cardEntry).upgraded;
}

// カードエントリから実行用カード情報を取得する
function getCardData(cardEntry) {
  const normalized = normalizeCardEntry(cardEntry);
  const baseCard = window.CARD_LIBRARY[normalized.id];
  if (!normalized.upgraded) {
    return {
      ...baseCard,
      entry: normalized,
      upgraded: false
    };
  }

  const upgrade = window.CARD_UPGRADE_LIBRARY[normalized.id];
  if (!upgrade) {
    return {
      ...baseCard,
      entry: normalized,
      upgraded: true
    };
  }

  return {
    ...baseCard,
    ...upgrade,
    effect: upgrade.effect ? { ...upgrade.effect } : { ...baseCard.effect },
    entry: normalized,
    upgraded: true
  };
}

// 敵の行動パターン一覧
const enemyIntents = [
  { type: "attack", value: 8 },
  { type: "attack", value: 12 },
  { type: "attack", value: 16 },
  { type: "attackAndBlock", damage: 8, block: 6 },
  { type: "attackAndDebuff", value: 8, debuff: { vulnerable: 2 } },
  { type: "attackAndDebuff", value: 10, debuff: { weak: 2 } },
  { type: "block", value: 10 },
  { type: "block", value: 14 },
  { type: "buff", status: { strength: 3 } },
  { type: "debuff", debuff: { poison: 3 } }
];

const elements = {
  playerHp: document.getElementById("playerHp"),
  playerBlock: document.getElementById("playerBlock"),
  playerEnergy: document.getElementById("playerEnergy"),
  playerStatuses: document.getElementById("playerStatuses"),
  enemyHp: document.getElementById("enemyHp"),
  enemyBlock: document.getElementById("enemyBlock"),
  enemyStatuses: document.getElementById("enemyStatuses"),
  enemyIntentDisplay: document.getElementById("enemyIntentDisplay"),
  drawPileCount: document.getElementById("drawPileCount"),
  discardPileCount: document.getElementById("discardPileCount"),
  exhaustPileCount: document.getElementById("exhaustPileCount"),
  hand: document.getElementById("hand"),
  message: document.getElementById("message"),
  log: document.getElementById("log"),
  endTurnButton: document.getElementById("endTurnButton"),
  deckViewButton: document.getElementById("deckViewButton"),
  turnIndicator: document.getElementById("turnIndicator"),
  incomingDamageBadge: document.getElementById("incomingDamageBadge"),
  predictedIncomingDamage: document.getElementById("predictedIncomingDamage"),
  rewardSection: document.getElementById("rewardSection"),
  rewardCards: document.getElementById("rewardCards"),
  skipRewardButton: document.getElementById("skipRewardButton"),
  deckOverlay: document.getElementById("deckOverlay"),
  deckList: document.getElementById("deckList"),
  closeDeckButton: document.getElementById("closeDeckButton"),
  drawPileButton: document.getElementById("drawPileButton"),
  drawPileBadge: document.getElementById("drawPileBadge"),
  drawOverlay: document.getElementById("drawOverlay"),
  drawList: document.getElementById("drawList"),
  closeDrawButton: document.getElementById("closeDrawButton"),
  discardPileButton: document.getElementById("discardPileButton"),
  discardPileBadge: document.getElementById("discardPileBadge"),
  discardOverlay: document.getElementById("discardOverlay"),
  discardList: document.getElementById("discardList"),
  closeDiscardButton: document.getElementById("closeDiscardButton"),
  exhaustPileButton: document.getElementById("exhaustPileButton"),
  exhaustPileBadge: document.getElementById("exhaustPileBadge"),
  exhaustOverlay: document.getElementById("exhaustOverlay"),
  exhaustList: document.getElementById("exhaustList"),
  closeExhaustButton: document.getElementById("closeExhaustButton"),
  enemyPanel: document.getElementById("enemyPanel"),
  playerPanel: document.getElementById("playerPanel")
};

// ログを追加する
function pushLog(text) {
  if (!elements.log) {
    return;
  }
  const item = document.createElement("li");
  item.textContent = text;
  elements.log.prepend(item);

  const maxLogs = 30;
  while (elements.log.children.length > maxLogs) {
    elements.log.removeChild(elements.log.lastChild);
  }
}

// 指定時間待機する
function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

// 画面中央にターン通知を表示する
function showAnnouncement(text, mode) {
  const announcement = document.createElement("div");
  announcement.className = `announcement announcement--${mode}`;
  announcement.textContent = text;
  document.body.appendChild(announcement);
  setTimeout(() => {
    announcement.remove();
  }, 900);
}

// 画面全体を赤くフラッシュする
function triggerScreenFlash(color = "#cc0000") {
  const flash = document.createElement("div");
  flash.className = "screen-flash";
  flash.style.background = color;
  document.body.appendChild(flash);
  setTimeout(() => {
    flash.remove();
  }, 460);
}

// 敵パネルを赤くフラッシュする
function flashEnemyPanel() {
  if (!elements.enemyPanel) {
    return;
  }
  elements.enemyPanel.classList.remove("enemy-hit-flash");
  void elements.enemyPanel.offsetWidth;
  elements.enemyPanel.classList.add("enemy-hit-flash");
  setTimeout(() => {
    elements.enemyPanel.classList.remove("enemy-hit-flash");
  }, 260);
}

// パネルをシェイクする
function shakePanel(panelElement) {
  if (!panelElement) {
    return;
  }
  panelElement.classList.remove("shake");
  void panelElement.offsetWidth;
  panelElement.classList.add("shake");
  setTimeout(() => {
    panelElement.classList.remove("shake");
  }, 380);
}

// 数値エフェクトを表示する
function showFloatingNumber(targetElement, text, mode, offsetX = 0, delay = 0) {
  if (!targetElement) {
    return;
  }

  const rect = targetElement.getBoundingClientRect();
  const number = document.createElement("div");
  number.className = `damage-number damage-number--${mode}`;
  number.textContent = text;
  number.style.left = `${rect.left + rect.width / 2 + offsetX}px`;
  number.style.top = `${rect.top + 12}px`;
  number.style.animationDelay = `${delay}ms`;
  document.body.appendChild(number);

  setTimeout(() => {
    number.remove();
  }, 900 + delay);
}

// 勝敗時の大型表示を行う
function showEndOverlay(mode) {
  // 既存の勝敗オーバーレイを先に除去する
  document.querySelectorAll(".end-overlay, .defeat-bg").forEach((node) => {
    node.remove();
  });

  if (mode === "defeat") {
    const darken = document.createElement("div");
    darken.className = "defeat-bg";
    document.body.appendChild(darken);
  } else {
    triggerScreenFlash("rgba(240, 210, 120, 0.45)");
  }

  const overlay = document.createElement("div");
  overlay.className = `end-overlay end-overlay--${mode}`;
  overlay.textContent = mode === "victory" ? "VICTORY!" : "DEFEATED...";
  document.body.appendChild(overlay);

  // 勝利表示は一定時間で自動的に消す
  if (mode === "victory") {
    setTimeout(() => {
      overlay.remove();
    }, 1400);
  }
}

// 座標が矩形内か判定する
function isPointInsideRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// カードタイプごとのドロップ可能パネルを返す
function getDropTargetPanel(cardType) {
  if (cardType === "攻撃") {
    return elements.enemyPanel;
  }
  return elements.playerPanel;
}

// カード発動後に捨て札アイコンへ飛ばす
function animateCardToDiscard(cardElement, delay = 0) {
  if (!cardElement || !elements.discardPileButton) {
    return Promise.resolve();
  }

  const sourceRect = cardElement.getBoundingClientRect();
  const targetRect = elements.discardPileButton.getBoundingClientRect();
  const projectile = cardElement.cloneNode(true);
  projectile.classList.add("card-discard-fly");
  projectile.style.left = `${sourceRect.left}px`;
  projectile.style.top = `${sourceRect.top}px`;
  projectile.style.width = `${sourceRect.width}px`;
  projectile.style.height = `${sourceRect.height}px`;
  projectile.style.transform = "rotate(0deg)";
  document.body.appendChild(projectile);

  const targetLeft = targetRect.left + (targetRect.width - sourceRect.width) / 2;
  const targetTop = targetRect.top + (targetRect.height - sourceRect.height) / 2;

  setTimeout(() => {
    requestAnimationFrame(() => {
      projectile.style.left = `${targetLeft}px`;
      projectile.style.top = `${targetTop}px`;
      projectile.style.transform = "rotate(360deg)";
      projectile.style.opacity = "0";
    });
  }, delay);

  return new Promise((resolve) => {
    setTimeout(() => {
      projectile.remove();
      resolve();
    }, 320 + delay);
  });
}

// カード表示要素を作成する
function createCardViewElement(cardEntry) {
  const card = getCardData(cardEntry);
  const item = document.createElement("div");
  item.className = `card card--${typeToClass(card.type)}`;
  item.innerHTML = `
    <div class="card-type">${card.type}</div>
    <div class="card-header">
      <span class="card-title">${card.name}${card.upgraded ? "+" : ""}</span>
      <span class="card-rarity">${card.rarity}</span>
    </div>
    <div class="card-cost-badge">${card.cost}</div>
    <div class="card-text">${card.text}</div>
  `;
  return item;
}

// 山札・捨て札・廃棄札の一覧を描画する
function renderPileList(container, cardEntries, emptyText) {
  container.innerHTML = "";

  if (cardEntries.length === 0) {
    const text = document.createElement("p");
    text.textContent = emptyText;
    container.appendChild(text);
    return;
  }

  cardEntries.forEach((cardEntry) => {
    container.appendChild(createCardViewElement(cardEntry));
  });
}

// バトル中かどうかを判定する
function isBattleActive() {
  return !gameState.isDefeated && !gameState.inReward;
}

// ステータス表示用テキストを作る
function formatStatusText(statusEntry) {
  if (statusEntry.id === "strength" || statusEntry.id === "dexterity") {
    return `${statusEntry.label}+${statusEntry.value}`;
  }
  return `${statusEntry.label}${statusEntry.value}`;
}

// ステータスの説明文を返す
function getStatusDescription(statusEntry) {
  const descriptions = {
    strength: "与える攻撃ダメージ+1（永続）",
    dexterity: "得るブロック+1（永続）",
    artifact: "次に受けるデバフを1回無効化",
    vulnerable: "受ける攻撃ダメージ1.5倍（ターン終了時に-1）",
    weak: "与える攻撃ダメージ0.75倍（ターン終了時に-1）",
    poison: "ターン終了時に同値ダメージを受け、その後-1",
    burn: "ターン終了時に5×スタックのダメージを受ける",
    restrained: "次の自ターンで行動不能（自ターン開始時に1消費）"
  };
  return descriptions[statusEntry.id] || "";
}

// 次に受ける被ダメージを予測する
function getPredictedIncomingDamage() {
  const intent = gameState.enemy.intent;
  const player = gameState.player;
  const enemy = gameState.enemy;

  if (!intent) {
    return 0;
  }

  let attackBase = 0;
  if (intent.type === "attack") {
    attackBase = intent.value;
  } else if (intent.type === "attackAndBlock") {
    attackBase = intent.damage;
  } else if (intent.type === "attackAndDebuff") {
    attackBase = intent.value;
  }

  if (attackBase <= 0) {
    return 0;
  }

  const rawDamage = window.calculateModifiedDamage(attackBase, enemy.status, player.status);
  return Math.max(0, rawDamage - player.block);
}

// ターン表示テキストを返す
function getTurnIndicatorText() {
  if (gameState.isDefeated) {
    return "DEFEATED";
  }
  if (gameState.inReward) {
    return "REWARD";
  }
  if (gameState.currentPhase === "enemy") {
    return "ENEMY TURN";
  }
  return "PLAYER TURN";
}

// カードタイプをCSSクラス名に変換する
function typeToClass(type) {
  const map = { "攻撃": "attack", "防御": "defense", "スキル": "skill", "パワー": "power" };
  return map[type] || "skill";
}

// ステータス表示を描画する
function renderStatuses(container, status) {
  const list = window.getStatusViewList(status);
  container.innerHTML = "";

  if (list.length === 0) {
    return;
  }

  list.forEach((entry) => {
    const badge = document.createElement("span");
    badge.className = `status-badge status-badge--${entry.id}`;
    badge.textContent = formatStatusText(entry);
    badge.title = `${formatStatusText(entry)}: ${getStatusDescription(entry)}`;
    container.appendChild(badge);
  });
}

// 攻撃ダメージを計算して与える
function dealAttackDamage(attacker, defender, baseDamage, attackerName, defenderName) {
  const modifiedDamage = window.calculateModifiedDamage(baseDamage, attacker.status, defender.status);
  const result = applyBlockedDamage(defender, modifiedDamage);
  pushLog(`${attackerName}の攻撃で${defenderName}に${result.dealt}ダメージ（ブロック${result.blocked}軽減）`);

  const targetPanel = defender === gameState.enemy ? elements.enemyPanel : elements.playerPanel;
  if (result.dealt > 0) {
    showFloatingNumber(targetPanel, String(result.dealt), "damage");
    if (defender === gameState.enemy) {
      shakePanel(elements.enemyPanel);
      flashEnemyPanel();
    } else {
      shakePanel(elements.playerPanel);
      triggerScreenFlash();
    }
  }
  if (result.blocked > 0) {
    showFloatingNumber(targetPanel, `BLOCK ${result.blocked}`, "block", 28, 70);
  }

  if (defender === gameState.player) {
    gameState.player.damageTakenThisTurn += result.dealt;
  }
}

// ブロックを得る
function gainBlock(target, baseBlock, targetName) {
  const blockValue = window.calculateModifiedBlock(baseBlock, target.status);
  target.block += blockValue;
  pushLog(`${targetName}がブロック${blockValue}獲得`);
  const targetPanel = target === gameState.enemy ? elements.enemyPanel : elements.playerPanel;
  showFloatingNumber(targetPanel, `+${blockValue}`, "block", -20, 40);
}

// ステータスを付与する
function grantStatus(target, statusMap, targetName) {
  Object.keys(statusMap).forEach((statusId) => {
    window.addStatus(target, statusId, statusMap[statusId], pushLog, targetName);
  });
}

// 山札が空のとき捨て山を戻す
function refillDrawPileIfNeeded() {
  const player = gameState.player;
  if (player.drawPile.length === 0 && player.discardPile.length > 0) {
    player.drawPile = shuffle(player.discardPile);
    player.discardPile = [];
    pushLog("捨て山をシャッフルして山札に戻した");
  }
}

// 指定枚数カードを引く
function drawCards(count, source) {
  const player = gameState.player;

  if (player.noDrawThisTurn && source !== "turnStart") {
    pushLog("このターンはドロー不可");
    return 0;
  }

  let drawn = 0;
  for (let drawCount = 0; drawCount < count; drawCount += 1) {
    refillDrawPileIfNeeded();
    if (player.drawPile.length === 0) {
      break;
    }
    const cardEntry = player.drawPile.pop();
    player.hand.push(cloneCardEntry(cardEntry));
    drawn += 1;
  }
  return drawn;
}

// 手札のカードを廃棄する
function exhaustCardFromHand(index) {
  const player = gameState.player;
  const exhaustedCard = player.hand.splice(index, 1)[0];
  if (exhaustedCard) {
    const entry = normalizeCardEntry(exhaustedCard);
    player.exhaustPile.push(cloneCardEntry(entry));
    pushLog(`${getCardData(entry).name}を廃棄`);
    return exhaustedCard;
  }
  return null;
}

// 敵の行動を決定する
function chooseEnemyIntent() {
  const intentIndex = Math.floor(Math.random() * enemyIntents.length);
  const baseIntent = enemyIntents[intentIndex];
  const nextIntent = { ...baseIntent };

  if (nextIntent.type === "attack") {
    nextIntent.value = randomInt(6, 18);
  }
  if (nextIntent.type === "block") {
    nextIntent.value = randomInt(8, 14);
  }

  gameState.enemy.intent = nextIntent;
  gameState.enemyIntentVersion += 1;
}

// 敵の次行動表示HTMLを作成する
// 筋力補正・プレイヤーの脆弱補正を考慮した実ダメージを表示する
function buildIntentDisplay(intent) {
  if (!intent) {
    return "<span class=\"intent-waiting\">...</span>";
  }

  // ステータスを考慮した実際の予測ダメージを計算して表示文字列を返す
  function calcDisplayDamage(baseValue) {
    const modified = window.calculateModifiedDamage(
      baseValue,
      gameState.enemy.status,
      gameState.player.status
    );
    // 素値と異なる場合は変化を括弧内に示す
    if (modified !== baseValue) {
      return `${modified}<span class="intent-base">(${baseValue})</span>`;
    }
    return String(modified);
  }

  if (intent.type === "attack") {
    return `<span class="intent-icon intent-attack">⚔️</span><span class="intent-value intent-attack">${calcDisplayDamage(intent.value)}</span>`;
  }
  if (intent.type === "block") {
    return `<span class="intent-icon intent-block">🛡️</span><span class="intent-value intent-block">${intent.value}</span>`;
  }
  if (intent.type === "buff") {
    return "<span class=\"intent-icon intent-buff\">⬆️</span>";
  }
  if (intent.type === "debuff") {
    return "<span class=\"intent-icon intent-debuff\">⬇️</span>";
  }
  if (intent.type === "attackAndDebuff") {
    return `<span class="intent-icon intent-attack">⚔️</span><span class="intent-value intent-attack">${calcDisplayDamage(intent.value)}</span><span class="intent-icon intent-debuff">⬇️</span>`;
  }
  if (intent.type === "attackAndBlock") {
    return `<span class="intent-icon intent-attack">⚔️</span><span class="intent-value intent-attack">${calcDisplayDamage(intent.damage)}</span><span class="intent-icon intent-block">🛡️</span><span class="intent-value intent-block">${intent.block}</span>`;
  }

  return "<span class=\"intent-waiting\">...</span>";
}

// 敵の行動表示を更新する
// force=true のとき、または表示内容が変化したときに再描画する
function renderEnemyIntent(force = false) {
  if (!elements.enemyIntentDisplay) {
    return;
  }

  const newHtml = buildIntentDisplay(gameState.enemy.intent);
  const versionChanged = gameState.renderedEnemyIntentVersion !== gameState.enemyIntentVersion;

  // 内容に変化がなく強制でもなければ何もしない
  if (!force && !versionChanged && gameState.lastIntentDisplayHtml === newHtml) {
    return;
  }

  const wrapper = document.createElement("div");
  // アニメーションはインテントが新しく選ばれたときのみ付与する
  wrapper.className = versionChanged ? "intent-display-inner" : "intent-display-inner intent-display-static";
  wrapper.innerHTML = newHtml;

  elements.enemyIntentDisplay.innerHTML = "";
  elements.enemyIntentDisplay.appendChild(wrapper);
  gameState.renderedEnemyIntentVersion = gameState.enemyIntentVersion;
  gameState.lastIntentDisplayHtml = newHtml;
}

// 敵の行動を実行する
function executeEnemyIntent() {
  const enemy = gameState.enemy;
  const intent = enemy.intent;

  if (!intent || !isBattleActive()) {
    return;
  }

  if (intent.type === "attack") {
    dealAttackDamage(enemy, gameState.player, intent.value, "敵", "プレイヤー");
  } else if (intent.type === "block") {
    gainBlock(enemy, intent.value, "敵");
  } else if (intent.type === "attackAndBlock") {
    dealAttackDamage(enemy, gameState.player, intent.damage, "敵", "プレイヤー");
    gainBlock(enemy, intent.block, "敵");
  } else if (intent.type === "attackAndDebuff") {
    dealAttackDamage(enemy, gameState.player, intent.value, "敵", "プレイヤー");
    grantStatus(gameState.player, intent.debuff, "プレイヤー");
  } else if (intent.type === "buff") {
    grantStatus(enemy, intent.status, "敵");
  } else if (intent.type === "debuff") {
    grantStatus(gameState.player, intent.debuff, "プレイヤー");
  }
}

// ターン終了時に一時筋力を戻す
function resolveTemporaryStrengthLoss() {
  const player = gameState.player;
  if (player.temporaryStrengthLoss > 0) {
    player.status.strength = Math.max(0, player.status.strength - player.temporaryStrengthLoss);
    pushLog(`激怒の効果が切れ、筋力-${player.temporaryStrengthLoss}`);
    player.temporaryStrengthLoss = 0;
  }
}

// ターン終了時ステータスを処理する
function processEndOfTurnStatuses() {
  window.applyEndOfTurnStatusEffects(gameState.player, "プレイヤー", {
    directDamage: (target, amount) => {
      const damage = applyDirectDamage(target, amount);
      gameState.player.damageTakenThisTurn += damage;
      if (damage > 0) {
        showFloatingNumber(elements.playerPanel, String(damage), "damage", 16, 60);
        shakePanel(elements.playerPanel);
        triggerScreenFlash();
      }
    },
    pushLog
  });

  window.applyEndOfTurnStatusEffects(gameState.enemy, "敵", {
    directDamage: (target, amount) => {
      const damage = applyDirectDamage(target, amount);
      if (damage > 0) {
        showFloatingNumber(elements.enemyPanel, String(damage), "damage", -14, 60);
        shakePanel(elements.enemyPanel);
      }
    },
    pushLog
  });
}

// 報酬のレアリティを抽選する
function rollRewardRarity() {
  const value = randomInt(1, 100);
  if (value <= 60) {
    return "common";
  }
  if (value <= 90) {
    return "uncommon";
  }
  return "rare";
}

// 報酬カード候補3枚を作る
function generateRewardChoices() {
  const choices = [];
  const used = new Set();
  const allPool = [...window.REWARD_POOLS.common, ...window.REWARD_POOLS.uncommon, ...window.REWARD_POOLS.rare];

  let attempts = 0;
  while (choices.length < 3 && attempts < 50) {
    attempts += 1;
    const rarity = rollRewardRarity();
    const pool = window.REWARD_POOLS[rarity];
    const cardId = pool[Math.floor(Math.random() * pool.length)];
    if (!used.has(cardId)) {
      used.add(cardId);
      choices.push(cardId);
    }
  }

  for (let index = 0; index < allPool.length && choices.length < 3; index += 1) {
    const cardId = allPool[index];
    if (!used.has(cardId)) {
      used.add(cardId);
      choices.push(cardId);
    }
  }

  return choices;
}

// 報酬画面を表示する
function showRewardSection() {
  gameState.inReward = true;
  gameState.currentPhase = "reward";
  gameState.rewardChoices = generateRewardChoices();
  elements.rewardSection.classList.remove("hidden");
  elements.rewardCards.innerHTML = "";

  gameState.rewardChoices.forEach((cardId) => {
    const card = getCardData(window.createCardInstance(cardId));
    const button = document.createElement("button");
    button.type = "button";
    button.className = `reward-card card--${typeToClass(card.type)}`;
    button.innerHTML = `
      <div class="card-type">${card.type}</div>
      <div class="card-header">
        <span class="card-title">${card.name}</span>
        <span class="card-rarity">${card.rarity}</span>
      </div>
      <div class="card-cost-badge">${card.cost}</div>
      <div class="card-text">${card.text}</div>
    `;

    button.addEventListener("click", () => {
      addRewardCard(cardId);
    });

    elements.rewardCards.appendChild(button);
  });

  elements.message.textContent = "カードを1枚選んでください";
}

// 報酬カードをデッキへ追加する
function addRewardCard(cardId) {
  if (!gameState.inReward) {
    return;
  }

  gameState.player.masterDeck.push(window.createCardInstance(cardId, false));
  pushLog(`${window.CARD_LIBRARY[cardId].name}をデッキに追加`);
  hideRewardSection();
  elements.message.textContent = "報酬獲得";
  renderDeckList();

  // マルチモード時はサーバーに報酬選択を通知する
  const isMultiMode = new URLSearchParams(window.location.search).get("mode") === "multi";
  if (isMultiMode) {
    window.MultiplayerAPI?.sendRewardSelected(cardId);
  }

  if (typeof gameState.flow.onRewardResolved === "function") {
    gameState.flow.onRewardResolved({
      pickedCardId: cardId
    });
  }
}

// デッキ一覧を表示用に更新する
function renderDeckList() {
  renderPileList(elements.deckList, gameState.player.masterDeck, "デッキは空です");
}

// 捨て札一覧を表示用に更新する
function renderDiscardList() {
  renderPileList(elements.discardList, gameState.player.discardPile, "捨て札はありません");
}

// 山札一覧を表示用に更新する（順序の意味は持たせない）
function renderDrawList() {
  const randomizedDrawCards = shuffle(gameState.player.drawPile);
  renderPileList(elements.drawList, randomizedDrawCards, "山札は空です");
}

// 廃棄札一覧を表示用に更新する
function renderExhaustList() {
  renderPileList(elements.exhaustList, gameState.player.exhaustPile, "廃棄札はありません");
}

// 勝敗判定を行う
function checkBattleEnd() {
  if (gameState.enemy.hp <= 0 && !gameState.inReward) {
    const feedHeal = gameState.player.powers.feed ? gameState.player.powers.feedHeal : 0;

    if (gameState.player.powers.feed) {
      gameState.player.maxHp += feedHeal;
      gameState.player.hp += feedHeal;
      pushLog(`捕食の効果で最大HP+${feedHeal}`);
      showFloatingNumber(elements.playerPanel, `+${feedHeal}`, "heal");
    }
    pushLog("バトル勝利");

    if (typeof gameState.flow.onBattleWin === "function") {
      gameState.flow.onBattleWin({
        isBoss: gameState.flow.isBossBattle,
        roomNumber: gameState.flow.roomNumber
      });
    }

    if (gameState.flow.isBossBattle) {
      showEndOverlay("victory");
      return true;
    }

    // マルチモード時はサーバーからの reward_start イベントで報酬画面を表示するためスキップする
    const isMultiMode = new URLSearchParams(window.location.search).get("mode") === "multi";
    if (!isMultiMode) {
      showRewardSection();
    }
    return true;
  }

  if (gameState.player.hp <= 0) {
    gameState.isDefeated = true;
    elements.message.textContent = "敗北…";
    pushLog("バトル敗北");
    showEndOverlay("defeat");

    if (typeof gameState.flow.onBattleLose === "function") {
      gameState.flow.onBattleLose({
        roomNumber: gameState.flow.roomNumber
      });
    }

    return true;
  }

  return false;
}

// カード効果を実行する
function resolveCardEffect(card) {
  const player = gameState.player;
  const enemy = gameState.enemy;
  const effect = card.effect;

  if (effect.damage) {
    dealAttackDamage(player, enemy, effect.damage, card.name, "敵");
  }

  if (effect.multiDamage) {
    effect.multiDamage.forEach((hitDamage) => {
      dealAttackDamage(player, enemy, hitDamage, card.name, "敵");
    });
  }

  if (effect.damageFromTakenMultiplier) {
    const baseDamage = player.damageTakenThisTurn * effect.damageFromTakenMultiplier;
    dealAttackDamage(player, enemy, baseDamage, card.name, "敵");
  }

  if (effect.damagePerExhaustedHand) {
    const exhaustedCount = player.hand.length;
    for (let index = player.hand.length - 1; index >= 0; index -= 1) {
      exhaustCardFromHand(index);
    }
    const baseDamage = exhaustedCount * effect.damagePerExhaustedHand;
    dealAttackDamage(player, enemy, baseDamage, card.name, "敵");
  }

  if (effect.block) {
    gainBlock(player, effect.block, "プレイヤー");
  }

  if (effect.energy) {
    player.energy = Math.min(player.maxEnergy, player.energy + effect.energy);
    pushLog(`${card.name}でマナ${effect.energy}回復`);
  }

  if (effect.draw) {
    const drawCount = drawCards(effect.draw, "effect");
    if (drawCount > 0) {
      pushLog(`${card.name}で${drawCount}ドロー`);
    }
  }

  if (effect.applyStatusToEnemy) {
    grantStatus(enemy, effect.applyStatusToEnemy, "敵");
  }

  if (effect.applyStatusToSelf) {
    grantStatus(player, effect.applyStatusToSelf, "プレイヤー");
  }

  if (effect.temporaryStrength) {
    window.addStatus(player, "strength", effect.temporaryStrength, pushLog, "プレイヤー");
    player.temporaryStrengthLoss += effect.temporaryStrength;
  }

  if (effect.exhaustOneFromHand && player.hand.length > 0) {
    exhaustCardFromHand(0);
  }

  if (effect.exhaustNonAttackAndGainBlock) {
    let exhaustCount = 0;
    for (let index = player.hand.length - 1; index >= 0; index -= 1) {
      const cardEntry = player.hand[index];
      const handCard = getCardData(cardEntry);
      if (handCard.type !== "攻撃") {
        exhaustCardFromHand(index);
        exhaustCount += 1;
      }
    }
    if (exhaustCount > 0) {
      const gained = effect.exhaustNonAttackAndGainBlock * exhaustCount;
      gainBlock(player, gained, "プレイヤー");
    }
  }

  if (effect.noDrawThisTurn) {
    player.noDrawThisTurn = true;
    pushLog("このターンはこれ以上ドローできない");
  }

  if (effect.grantPower) {
    player.powers[effect.grantPower] = true;
    if (effect.grantPower === "demonForm") {
      player.powers.demonFormStrength = card.upgraded ? 3 : 2;
    }
    if (effect.grantPower === "feed") {
      player.powers.feedHeal = card.upgraded ? 5 : 3;
    }
    pushLog(`${card.name}を展開`);
  }
}

// 手札のカードを使用する
async function playCard(handIndex, cardElement) {
  // マルチモードではローカルでカード効果を適用せず、
  // サーバーに使用要求のみ送信する（カード効果はサーバー権威で処理される）。
  // ローカル状態はサーバーからの game_state_update で同期される。
  const isMultiMode = new URLSearchParams(window.location.search).get("mode") === "multi";
  if (isMultiMode) {
    if (window.MultiplayerAPI?.isEndTurnSent?.()) {
      return false;
    }
    const cardEntry = gameState.player.hand[handIndex];
    if (!cardEntry) {
      return false;
    }
    const cardId = typeof cardEntry === "string" ? cardEntry : cardEntry.id;
    // ローカルのエネルギー値で事前チェック（サーバー側でも検証される）
    const cardDefMulti = window.CARD_LIBRARY ? window.CARD_LIBRARY[cardId] : null;
    const costMulti = cardDefMulti ? (cardDefMulti.cost || 0) : 0;
    if ((gameState.player.energy || 0) < costMulti) {
      elements.message.textContent = "マナ不足でカードを使えない";
      return false;
    }
    if (window.MultiplayerAPI && typeof window.MultiplayerAPI.sendSelectCard === "function") {
      window.MultiplayerAPI.sendSelectCard(cardId);
    }
    // ドラッグ演出のために cardElement を捨て札へ飛ばすアニメーションだけ走らせる
    if (cardElement) {
      try { await animateCardToDiscard(cardElement); } catch (_) { /* 演出失敗は無視 */ }
    }
    return true;
  }

  if (!isBattleActive() || gameState.isAnimating) {
    return false;
  }

  const player = gameState.player;

  if (player.turnLocked) {
    elements.message.textContent = "拘束中で行動できない";
    return false;
  }

  const cardEntry = player.hand[handIndex];
  const card = getCardData(cardEntry);

  if (!card) {
    return false;
  }

  if (player.energy < card.cost) {
    elements.message.textContent = "マナ不足でカードを使えない";
    return false;
  }

  gameState.isAnimating = true;
  player.energy -= card.cost;
  player.hand.splice(handIndex, 1);
  pushLog(`${card.name}を使用`);
  render();

  resolveCardEffect(card);
  await animateCardToDiscard(cardElement);
  player.discardPile.push(cloneCardEntry(cardEntry));

  checkBattleEnd();
  gameState.isAnimating = false;
  render();
  return true;
}

// カードが現在使用可能かどうかの理由を返す
function getCardDisabledReason(card) {
  const player = gameState.player;
  // マルチモードのターン終了済みチェック
  const multiParams = new URLSearchParams(window.location.search);
  if (multiParams.get("mode") === "multi") {
    if (window.MultiplayerAPI?.isEndTurnSent?.()) {
      return "ターン終了済み";
    }
  }
  if (!isBattleActive()) {
    return "行動不可";
  }
  if (gameState.isAnimating) {
    return "演出中";
  }
  if (player.turnLocked) {
    return "拘束中";
  }
  if (player.energy < card.cost) {
    return "マナ不足";
  }
  return "";
}

// ドロップ候補パネルのハイライトを更新する
function updateDropTargetHighlight(cardType, pointerX, pointerY) {
  const targetPanel = getDropTargetPanel(cardType);
  const enemyRect = elements.enemyPanel.getBoundingClientRect();
  const playerRect = elements.playerPanel.getBoundingClientRect();

  elements.enemyPanel.classList.remove("drop-target-active");
  elements.playerPanel.classList.remove("drop-target-active");

  if (!targetPanel) {
    return false;
  }

  if (targetPanel === elements.enemyPanel && isPointInsideRect(pointerX, pointerY, enemyRect)) {
    elements.enemyPanel.classList.add("drop-target-active");
    return true;
  }
  if (targetPanel === elements.playerPanel && isPointInsideRect(pointerX, pointerY, playerRect)) {
    elements.playerPanel.classList.add("drop-target-active");
    return true;
  }
  return false;
}

// ドラッグキャンセル時に手札へ戻す
function cancelDragCard() {
  const drag = gameState.drag;
  if (!drag.active || !drag.element) {
    return;
  }

  const dragElement = drag.element;
  const returnIndex = drag.handIndex;
  drag.active = false;
  drag.handIndex = -1;
  drag.cardId = "";
  drag.pointerId = null;
  drag.pointerX = 0;
  drag.pointerY = 0;
  drag.element = null;

  document.body.classList.remove("is-dragging");
  elements.enemyPanel.classList.remove("drop-target-active");
  elements.playerPanel.classList.remove("drop-target-active");

  renderHand();

  const returnTarget = elements.hand.querySelector(`[data-hand-index="${returnIndex}"]`);
  if (returnTarget) {
    const targetRect = returnTarget.getBoundingClientRect();
    dragElement.classList.add("drag-canceling");
    dragElement.style.left = `${targetRect.left + targetRect.width / 2}px`;
    dragElement.style.top = `${targetRect.top + targetRect.height / 2}px`;
    dragElement.style.transform = "translate(-50%, -50%) scale(1)";
    setTimeout(() => {
      dragElement.remove();
    }, 220);
    return;
  }

  dragElement.remove();
}

// ドラッグ成功時にカードを発動する
async function commitDraggedCard() {
  const drag = gameState.drag;
  if (!drag.active || !drag.element) {
    return;
  }

  const handIndex = drag.handIndex;
  const dragElement = drag.element;
  // ドラッグ状態をクリアする
  drag.active = false;
  drag.handIndex = -1;
  drag.cardId = "";
  drag.pointerId = null;
  drag.pointerX = 0;
  drag.pointerY = 0;
  drag.element = null;

  document.body.classList.remove("is-dragging");
  elements.enemyPanel.classList.remove("drop-target-active");
  elements.playerPanel.classList.remove("drop-target-active");

  // 離した瞬間にドラッグカード本体を即非表示にする（飛んでいく演出はクローンが担う）
  dragElement.style.opacity = "0";
  dragElement.style.pointerEvents = "none";

  const played = await playCard(handIndex, dragElement);
  if (!played) {
    dragElement.style.opacity = "";
    dragElement.style.pointerEvents = "";
    render();
  }
  // マルチモードのカード送信は playCard 内部で sendSelectCard を呼ぶようになったため、
  // ここで重複送信しないようにする（以前の二重送信バグの修正）。
  dragElement.remove();
}

// ドラッグ中のポインター移動を処理する
function onCardPointerMove(event) {
  const drag = gameState.drag;
  if (!drag.active || !drag.element || drag.pointerId !== event.pointerId) {
    return;
  }

  drag.pointerX = event.clientX;
  drag.pointerY = event.clientY;
  drag.element.style.left = `${event.clientX}px`;
  drag.element.style.top = `${event.clientY}px`;
  updateDropTargetHighlight(getCardData(window.createCardInstance(drag.cardId)).type, event.clientX, event.clientY);
}

// ドラッグ終了時の処理を行う
function onCardPointerUp(event) {
  const drag = gameState.drag;
  if (!drag.active || !drag.element || drag.pointerId !== event.pointerId) {
    return;
  }

  document.removeEventListener("pointermove", onCardPointerMove);
  document.removeEventListener("pointerup", onCardPointerUp);
  document.removeEventListener("pointercancel", onCardPointerUp);

  const card = getCardData(window.createCardInstance(drag.cardId));
  const canDrop = updateDropTargetHighlight(card.type, event.clientX, event.clientY);

  if (canDrop) {
    commitDraggedCard();
    return;
  }

  cancelDragCard();
}

// 手札カード操作を開始する
function handleCardPointerDown(event, handIndex, cardId) {
  if (gameState.drag.active) {
    return;
  }

  if (event.pointerType === "touch") {
    event.preventDefault();
    const button = event.currentTarget;
    // マルチモードのタップ操作は multiplayer.js の click ハンドラに任せる
    // （二重送信防止）。ソロモードはここでカードを直接使用する。
    const isMultiModeTouch = new URLSearchParams(window.location.search).get("mode") === "multi";
    if (!isMultiModeTouch) {
      playCard(handIndex, button);
    }
    return;
  }

  if (event.button !== 0) {
    return;
  }

  const card = getCardData(window.createCardInstance(cardId));
  if (getCardDisabledReason(card)) {
    return;
  }

  event.preventDefault();

  const source = event.currentTarget;
  const sourceRect = source.getBoundingClientRect();
  const dragElement = source.cloneNode(true);
  dragElement.classList.add("dragging-card");
  dragElement.style.width = `${sourceRect.width}px`;
  dragElement.style.height = `${sourceRect.height}px`;
  dragElement.style.left = `${event.clientX}px`;
  dragElement.style.top = `${event.clientY}px`;
  document.body.appendChild(dragElement);

  gameState.drag.active = true;
  gameState.drag.handIndex = handIndex;
  gameState.drag.cardId = cardId;
  gameState.drag.pointerId = event.pointerId;
  gameState.drag.pointerX = event.clientX;
  gameState.drag.pointerY = event.clientY;
  gameState.drag.element = dragElement;

  document.body.classList.add("is-dragging");
  renderHand();

  document.addEventListener("pointermove", onCardPointerMove);
  document.addEventListener("pointerup", onCardPointerUp);
  document.addEventListener("pointercancel", onCardPointerUp);
}

// バトル画面内オーバーレイを1つ閉じる
function closeTopBattleOverlay() {
  if (!elements.exhaustOverlay.classList.contains("hidden")) {
    closeExhaustOverlay();
    return true;
  }
  if (!elements.discardOverlay.classList.contains("hidden")) {
    closeDiscardOverlay();
    return true;
  }
  if (!elements.drawOverlay.classList.contains("hidden")) {
    closeDrawOverlay();
    return true;
  }
  if (!elements.deckOverlay.classList.contains("hidden")) {
    closeDeckOverlay();
    return true;
  }
  return false;
}

// オーバーレイ背景クリック時の閉じる処理を登録する
function bindOverlayBackdropClose(overlayElement, closeHandler) {
  overlayElement.addEventListener("pointerdown", (event) => {
    if (event.target === overlayElement) {
      closeHandler();
    }
  });
}

// Escでオーバーレイを閉じる
function onGlobalKeyDown(event) {
  if (event.key !== "Escape") {
    return;
  }

  if (closeTopBattleOverlay()) {
    event.preventDefault();
  }
}

// プレイヤーターンを開始する
function startPlayerTurn() {
  if (!isBattleActive()) {
    return;
  }

  gameState.currentPhase = "player";

  const player = gameState.player;
  const enemy = gameState.enemy;

  player.damageTakenThisTurn = 0;
  player.noDrawThisTurn = false;
  player.temporaryStrengthLoss = 0;
  player.turnLocked = false;

  // バリケードパワーがない場合のみプレイヤーのブロックをリセットする
  if (!player.powers.barricade) {
    player.block = 0;
  }
  // 敵のブロックは endTurn() の冒頭でリセット済み

  if (player.powers.demonForm) {
    window.addStatus(player, "strength", player.powers.demonFormStrength, pushLog, "プレイヤー");
  }

  player.energy = player.maxEnergy;
  drawCards(5, "turnStart");
  chooseEnemyIntent();
  renderEnemyIntent();
  showAnnouncement("YOUR TURN", "player");

  if (player.status.restrained > 0) {
    player.turnLocked = true;
    player.status.restrained -= 1;
    elements.message.textContent = `ターン${gameState.turn} - 拘束で行動不能`;
    pushLog("拘束のためこのターン行動できない");
  } else {
    elements.message.textContent = `ターン${gameState.turn} - カードを選択してください`;
  }

  pushLog(`ターン${gameState.turn}開始`);
  render();
}

// ターン終了時に手札を捨て札へ飛ばす
async function animateHandToDiscardAtEndTurn() {
  const player = gameState.player;
  if (player.hand.length === 0) {
    return;
  }

  const handSnapshot = [...player.hand];
  const handElements = [...elements.hand.querySelectorAll(".hand-card")];

  const animationPromises = handElements.map((cardElement, index) => {
    cardElement.style.opacity = "0.18";
    return animateCardToDiscard(cardElement, index * 45);
  });

  await Promise.all(animationPromises);

  player.discardPile.push(...handSnapshot);
  player.hand = [];
  render();
}

// ターン終了処理
async function endTurn() {
  // マルチモードの場合はソロのターン処理を実行しない
  const multiParams = new URLSearchParams(window.location.search);
  if (multiParams.get("mode") === "multi") {
    return;
  }

  if (!isBattleActive() || gameState.isAnimating) {
    return;
  }

  gameState.currentPhase = "enemy";
  gameState.isAnimating = true;
  render();

  await animateHandToDiscardAtEndTurn();

  // 敵ターン開始時に敵のブロックをリセットする（STS準拠：ブロックは自分のターン開始時に消える）
  gameState.enemy.block = 0;

  pushLog("ターン終了");
  showAnnouncement("ENEMY TURN", "enemy");
  await wait(850);

  executeEnemyIntent();
  render();
  await wait(450);
  if (checkBattleEnd()) {
    gameState.isAnimating = false;
    render();
    return;
  }

  processEndOfTurnStatuses();
  resolveTemporaryStrengthLoss();

  // ブロックは次ターン開始時に0へ戻すため、ここでは維持する

  if (checkBattleEnd()) {
    gameState.isAnimating = false;
    render();
    return;
  }

  gameState.turn += 1;
  gameState.isAnimating = false;
  startPlayerTurn();
}

// 報酬画面を閉じる
function hideRewardSection() {
  elements.rewardSection.classList.add("hidden");
  elements.rewardCards.innerHTML = "";
  gameState.rewardChoices = [];
  gameState.inReward = false;
}

// 報酬をスキップする
function skipReward() {
  if (!gameState.inReward) {
    return;
  }
  hideRewardSection();
  elements.message.textContent = "報酬をスキップ";

  if (typeof gameState.flow.onRewardResolved === "function") {
    gameState.flow.onRewardResolved({
      pickedCardId: null
    });
  }
}

// 戦闘を準備する
function setupBattle(enemyHp) {
  const player = gameState.player;

  // 前戦闘の演出オーバーレイを掃除する
  document.querySelectorAll(".end-overlay, .defeat-bg").forEach((node) => {
    node.remove();
  });

  player.drawPile = shuffle(player.masterDeck.map((entry) => cloneCardEntry(entry)));
  player.discardPile = [];
  player.hand = [];
  player.exhaustPile = [];
  player.energy = player.maxEnergy;
  player.block = 0;
  player.status = window.createStatusState();
  player.powers = {
    demonForm: false,
    demonFormStrength: 2,
    feed: false,
    feedHeal: 3,
    barricade: false
  };
  player.noDrawThisTurn = false;
  player.turnLocked = false;
  player.damageTakenThisTurn = 0;
  player.temporaryStrengthLoss = 0;

  gameState.enemy.maxHp = enemyHp;
  gameState.enemy.hp = enemyHp;
  gameState.enemy.block = 0;
  gameState.enemy.status = window.createStatusState();
  gameState.enemy.intent = null;

  gameState.inReward = false;
  gameState.isAnimating = false;
  gameState.drag.active = false;
  gameState.drag.handIndex = -1;
  gameState.drag.cardId = "";
  gameState.drag.pointerId = null;
  gameState.drag.element = null;
  gameState.currentPhase = "player";
  gameState.turn = 1;
  gameState.enemyIntentVersion = 0;
  gameState.renderedEnemyIntentVersion = -1;
  hideRewardSection();
}

// バトル開始API
function startBattle(enemyHp, options = {}) {
  gameState.flow.isBossBattle = Boolean(options.isBoss);
  gameState.flow.roomNumber = options.roomNumber || 1;
  gameState.flow.onBattleWin = options.onBattleWin || null;
  gameState.flow.onBattleLose = options.onBattleLose || null;
  gameState.flow.onRewardResolved = options.onRewardResolved || null;

  setupBattle(enemyHp);
  pushLog(`バトル開始（敵HP${enemyHp}）`);
  startPlayerTurn();
}

// 手札UIを描画する
function renderHand() {
  const player = gameState.player;

  const previousRects = new Map();
  elements.hand.querySelectorAll(".hand-card").forEach((element) => {
    previousRects.set(element.dataset.handKey, element.getBoundingClientRect());
  });

  elements.hand.innerHTML = "";

  const isDragging = gameState.drag.active;

  player.hand.forEach((cardEntry, index) => {
    if (isDragging && index === gameState.drag.handIndex) {
      return;
    }

    const normalized = normalizeCardEntry(cardEntry);
    const card = getCardData(normalized);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `card hand-card card--${typeToClass(card.type)}`;
    button.dataset.handIndex = String(index);
    button.dataset.handKey = `${index}-${normalized.id}-${normalized.upgraded ? "u" : "n"}`;

    const disabledReason = getCardDisabledReason(card);
    button.disabled = disabledReason !== "";

    button.innerHTML = `
      <div class="card-type">${card.type}</div>
      <div class="card-header">
        <span class="card-title">${card.name}</span>
      </div>
      <div class="card-cost-badge">${card.cost}</div>
      <div class="card-text">${card.text}</div>
    `;

    if (disabledReason) {
      const reason = document.createElement("div");
      reason.className = "card-disabled-reason";
      reason.textContent = disabledReason;
      button.appendChild(reason);
    } else {
      button.addEventListener("pointerdown", (event) => {
        handleCardPointerDown(event, index, normalized.id);
      });
    }

    elements.hand.appendChild(button);
  });

  elements.hand.querySelectorAll(".hand-card").forEach((element) => {
    const currentRect = element.getBoundingClientRect();
    const previousRect = previousRects.get(element.dataset.handKey);
    if (!previousRect) {
      return;
    }
    const deltaX = previousRect.left - currentRect.left;
    if (Math.abs(deltaX) < 1) {
      return;
    }
    element.animate(
      [
        { transform: `translateX(${deltaX}px)` },
        { transform: "translateX(0px)" }
      ],
      {
        duration: 200,
        easing: "ease"
      }
    );
  });
}

// 全体UIを更新する
function render() {
  const player = gameState.player;
  const enemy = gameState.enemy;

  elements.playerHp.textContent = `${player.hp} / ${player.maxHp}`;
  elements.playerBlock.textContent = String(player.block);
  elements.playerEnergy.textContent = String(player.energy);

  elements.enemyHp.textContent = `${enemy.hp} / ${enemy.maxHp}`;
  elements.enemyBlock.textContent = String(enemy.block);
  // ステータス変化（脆弱・筋力など）を即時反映するため常に更新を試みる
  renderEnemyIntent(true);

  elements.drawPileCount.textContent = String(player.drawPile.length);
  elements.discardPileCount.textContent = String(player.discardPile.length);
  elements.exhaustPileCount.textContent = String(player.exhaustPile.length);

  if (elements.drawPileBadge) {
    elements.drawPileBadge.textContent = String(player.drawPile.length);
  }
  if (elements.discardPileBadge) {
    elements.discardPileBadge.textContent = String(player.discardPile.length);
  }
  if (elements.exhaustPileBadge) {
    elements.exhaustPileBadge.textContent = String(player.exhaustPile.length);
  }

  elements.endTurnButton.disabled = !isBattleActive() || gameState.isAnimating;

  if (elements.turnIndicator) {
    elements.turnIndicator.textContent = getTurnIndicatorText();
  }

  if (elements.predictedIncomingDamage && elements.incomingDamageBadge) {
    const predictedDamage = getPredictedIncomingDamage();
    elements.predictedIncomingDamage.textContent = String(predictedDamage);

    elements.incomingDamageBadge.classList.remove("incoming-badge--safe", "incoming-badge--warn", "incoming-badge--danger");
    if (predictedDamage >= 20) {
      elements.incomingDamageBadge.classList.add("incoming-badge--danger");
    } else if (predictedDamage >= 10) {
      elements.incomingDamageBadge.classList.add("incoming-badge--warn");
    } else {
      elements.incomingDamageBadge.classList.add("incoming-badge--safe");
    }
  }

  renderStatuses(elements.playerStatuses, player.status);
  renderStatuses(elements.enemyStatuses, enemy.status);
  renderHand();
}

// render・gameState を外部（multiplayer.js 等）から参照できるように公開する
window.render = render;
window.gameState = gameState;
window.showRewardSection = showRewardSection;
window.showAnnouncement = showAnnouncement;
// マルチモードで敵ターン死亡時にサーバーから受け取って敗北画面を出すため公開する
window.showEndOverlay = showEndOverlay;

// デッキオーバーレイを開く
function openDeckOverlay() {
  renderDeckList();
  elements.deckOverlay.classList.remove("hidden");
}

// デッキオーバーレイを閉じる
function closeDeckOverlay() {
  elements.deckOverlay.classList.add("hidden");
}

// 山札オーバーレイを開く
function openDrawOverlay() {
  renderDrawList();
  elements.drawOverlay.classList.remove("hidden");
}

// 山札オーバーレイを閉じる
function closeDrawOverlay() {
  elements.drawOverlay.classList.add("hidden");
}

// 捨て札オーバーレイを開く
function openDiscardOverlay() {
  renderDiscardList();
  elements.discardOverlay.classList.remove("hidden");
}

// 捨て札オーバーレイを閉じる
function closeDiscardOverlay() {
  elements.discardOverlay.classList.add("hidden");
}

// 廃棄札オーバーレイを開く
function openExhaustOverlay() {
  renderExhaustList();
  elements.exhaustOverlay.classList.remove("hidden");
}

// 廃棄札オーバーレイを閉じる
function closeExhaustOverlay() {
  elements.exhaustOverlay.classList.add("hidden");
}

// イベントを登録する
function bindEvents() {
  elements.endTurnButton.addEventListener("click", endTurn);
  elements.deckViewButton.addEventListener("click", openDeckOverlay);
  elements.closeDeckButton.addEventListener("click", closeDeckOverlay);
  elements.skipRewardButton.addEventListener("click", skipReward);
  elements.drawPileButton.addEventListener("click", openDrawOverlay);
  elements.closeDrawButton.addEventListener("click", closeDrawOverlay);
  elements.discardPileButton.addEventListener("click", openDiscardOverlay);
  elements.closeDiscardButton.addEventListener("click", closeDiscardOverlay);
  elements.exhaustPileButton.addEventListener("click", openExhaustOverlay);
  elements.closeExhaustButton.addEventListener("click", closeExhaustOverlay);

  bindOverlayBackdropClose(elements.deckOverlay, closeDeckOverlay);
  bindOverlayBackdropClose(elements.drawOverlay, closeDrawOverlay);
  bindOverlayBackdropClose(elements.discardOverlay, closeDiscardOverlay);
  bindOverlayBackdropClose(elements.exhaustOverlay, closeExhaustOverlay);

  document.addEventListener("keydown", onGlobalKeyDown);
}

// ゲームを初期化する
function initializeGame() {
  gameState.player.masterDeck = window.createStarterDeck().map((entry) => cloneCardEntry(entry));
  bindEvents();
  render();
}

// ランを初期化する
function resetRunState() {
  gameState.player.maxHp = 80;
  gameState.player.hp = 80;
  gameState.player.masterDeck = window.createStarterDeck().map((entry) => cloneCardEntry(entry));
  gameState.player.drawPile = [];
  gameState.player.discardPile = [];
  gameState.player.hand = [];
  gameState.player.exhaustPile = [];
  gameState.player.energy = gameState.player.maxEnergy;
  gameState.player.block = 0;
  gameState.player.status = window.createStatusState();
  gameState.player.powers = {
    demonForm: false,
    demonFormStrength: 2,
    feed: false,
    feedHeal: 3,
    barricade: false
  };
  gameState.isDefeated = false;
  hideRewardSection();
  render();
}

// マスターデッキを取得する
function getMasterDeck() {
  return gameState.player.masterDeck.map((entry) => cloneCardEntry(entry));
}

// マスターデッキを置き換える
function setMasterDeck(deckEntries) {
  gameState.player.masterDeck = deckEntries.map((entry) => cloneCardEntry(entry));
  render();
}

// マスターデッキへ1枚追加する
function addCardToDeck(cardEntry) {
  gameState.player.masterDeck.push(cloneCardEntry(cardEntry));
  render();
}

// プレイヤーHPを割合回復する
function healPlayerByPercent(ratio) {
  const healValue = Math.max(1, Math.floor(gameState.player.maxHp * ratio));
  const beforeHp = gameState.player.hp;
  gameState.player.hp = Math.min(gameState.player.maxHp, gameState.player.hp + healValue);
  const actualHeal = gameState.player.hp - beforeHp;
  render();
  return actualHeal;
}

// プレイヤー状態を取得する
function getPlayerState() {
  return {
    hp: gameState.player.hp,
    maxHp: gameState.player.maxHp,
    isDefeated: gameState.isDefeated
  };
}

window.BattleAPI = {
  startBattle,
  resetRunState,
  getMasterDeck,
  setMasterDeck,
  addCardToDeck,
  healPlayerByPercent,
  getPlayerState,
  createCardInstance: window.createCardInstance,
  getCardData
};

initializeGame();
