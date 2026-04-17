// カードデータ（サーバー側Node.js用）
// public/js/cards.js から移植。window.xxx の代わりに module.exports で公開する。

const CARD_LIBRARY = {
  strike: {
    id: "strike",
    name: "斬撃",
    cost: 1,
    type: "攻撃",
    rarity: "starter",
    text: "6ダメージを与える",
    effect: { damage: 6 }
  },
  defend: {
    id: "defend",
    name: "防御",
    cost: 1,
    type: "防御",
    rarity: "starter",
    text: "5ブロックを得る",
    effect: { block: 5 }
  },
  bash: {
    id: "bash",
    name: "強打",
    cost: 2,
    type: "攻撃",
    rarity: "starter",
    text: "15ダメージを与える",
    effect: { damage: 15 }
  },
  focus: {
    id: "focus",
    name: "気合",
    cost: 0,
    type: "スキル",
    rarity: "starter",
    text: "1マナ回復し、2ブロックを得る",
    effect: { energy: 1, block: 2 }
  },
  whirlwind: {
    id: "whirlwind",
    name: "旋風刃",
    cost: 1,
    type: "攻撃",
    rarity: "common",
    text: "5ダメージを2回与える",
    effect: { multiDamage: [5, 5] }
  },
  headbutt: {
    id: "headbutt",
    name: "脳天割り",
    cost: 2,
    type: "攻撃",
    rarity: "uncommon",
    text: "14ダメージを与え、敵に脆弱2付与",
    effect: { damage: 14, applyStatusToEnemy: { vulnerable: 2 } }
  },
  immolate: {
    id: "immolate",
    name: "鬼火",
    cost: 2,
    type: "攻撃",
    rarity: "rare",
    text: "手札を全廃棄し、廃棄枚数×7ダメージ",
    effect: { damagePerExhaustedHand: 7 }
  },
  pommelStrike: {
    id: "pommelStrike",
    name: "ポンメル",
    cost: 1,
    type: "攻撃",
    rarity: "common",
    text: "9ダメージを与え、1ドロー",
    effect: { damage: 9, draw: 1 }
  },
  bloodForBlood: {
    id: "bloodForBlood",
    name: "血には血を",
    cost: 2,
    type: "攻撃",
    rarity: "uncommon",
    text: "このターン受けたダメージ×3のダメージ",
    effect: { damageFromTakenMultiplier: 3 }
  },
  combustStrike: {
    id: "combustStrike",
    name: "焼身",
    cost: 2,
    type: "攻撃",
    rarity: "uncommon",
    text: "20ダメージを与え、自分に火傷1付与",
    effect: { damage: 20, applyStatusToSelf: { burn: 1 } }
  },
  cleave: {
    id: "cleave",
    name: "なぎ払い",
    cost: 1,
    type: "攻撃",
    rarity: "common",
    text: "敵全体に8ダメージ（現状は単体）",
    effect: { damage: 8 }
  },
  ironWall: {
    id: "ironWall",
    name: "鉄壁",
    cost: 2,
    type: "防御",
    rarity: "common",
    text: "12ブロックを得る",
    effect: { block: 12 }
  },
  anger: {
    id: "anger",
    name: "激怒",
    cost: 1,
    type: "スキル",
    rarity: "common",
    text: "筋力+3、ターン終了時に筋力-3",
    effect: { temporaryStrength: 3 }
  },
  battleTrance: {
    id: "battleTrance",
    name: "バトルトランス",
    cost: 0,
    type: "スキル",
    rarity: "common",
    text: "3ドローし、このターンドロー不可",
    effect: { draw: 3, noDrawThisTurn: true }
  },
  offering: {
    id: "offering",
    name: "供物",
    cost: 0,
    type: "スキル",
    rarity: "uncommon",
    text: "手札1枚廃棄し、エネルギー+2、2ドロー",
    effect: { exhaustOneFromHand: true, energy: 2, draw: 2 }
  },
  secondWind: {
    id: "secondWind",
    name: "セカンドウィンド",
    cost: 1,
    type: "スキル",
    rarity: "uncommon",
    text: "手札の非アタックカードを全廃棄し、1枚につき5ブロック",
    effect: { exhaustNonAttackAndGainBlock: 5 }
  },
  endure: {
    id: "endure",
    name: "やせ我慢",
    cost: 1,
    type: "スキル",
    rarity: "uncommon",
    text: "4ブロックを得て、自分に脱力1付与",
    effect: { block: 4, applyStatusToSelf: { weak: 1 } }
  },
  demonForm: {
    id: "demonForm",
    name: "悪魔化",
    cost: 3,
    type: "パワー",
    rarity: "rare",
    text: "毎ターン開始時に筋力+2",
    effect: { grantPower: "demonForm" }
  },
  feed: {
    id: "feed",
    name: "捕食",
    cost: 1,
    type: "パワー",
    rarity: "uncommon",
    text: "敵を倒すたびにHP+3",
    effect: { grantPower: "feed" }
  },
  barricade: {
    id: "barricade",
    name: "バリケード",
    cost: 3,
    type: "パワー",
    rarity: "rare",
    text: "ブロックがターン終了時に消えない",
    effect: { grantPower: "barricade" }
  }
};

const CARD_UPGRADE_LIBRARY = {
  strike: {
    text: "9ダメージを与える",
    effect: { damage: 9 },
    diffText: "+3ダメージ"
  },
  defend: {
    text: "8ブロックを得る",
    effect: { block: 8 },
    diffText: "+3ブロック"
  },
  bash: {
    text: "18ダメージを与え、敵に脆弱3付与",
    effect: { damage: 18, applyStatusToEnemy: { vulnerable: 3 } },
    diffText: "+3ダメージ / 脆弱+1"
  },
  whirlwind: {
    text: "8ダメージを2回与える",
    effect: { multiDamage: [8, 8] },
    diffText: "+3×2ヒット"
  },
  pommelStrike: {
    text: "10ダメージを与え、2ドロー",
    effect: { damage: 10, draw: 2 },
    diffText: "+1ダメージ / +1ドロー"
  },
  cleave: {
    text: "敵全体に11ダメージ（現状は単体）",
    effect: { damage: 11 },
    diffText: "+3ダメージ"
  },
  bloodForBlood: {
    text: "このターン受けたダメージ×4のダメージ",
    effect: { damageFromTakenMultiplier: 4 },
    diffText: "倍率+1"
  },
  combustStrike: {
    text: "27ダメージを与え、自分に火傷1付与",
    effect: { damage: 27, applyStatusToSelf: { burn: 1 } },
    diffText: "+7ダメージ"
  },
  immolate: {
    text: "手札を全廃棄し、廃棄枚数×10ダメージ",
    effect: { damagePerExhaustedHand: 10 },
    diffText: "倍率+3"
  },
  ironWall: {
    text: "16ブロックを得る",
    effect: { block: 16 },
    diffText: "+4ブロック"
  },
  endure: {
    text: "7ブロックを得て、自分に脱力1付与",
    effect: { block: 7, applyStatusToSelf: { weak: 1 } },
    diffText: "+3ブロック"
  },
  anger: {
    text: "筋力+4、ターン終了時に筋力-4",
    effect: { temporaryStrength: 4 },
    diffText: "筋力増減+1"
  },
  battleTrance: {
    text: "4ドローし、このターンドロー不可",
    effect: { draw: 4, noDrawThisTurn: true },
    diffText: "+1ドロー"
  },
  offering: {
    text: "手札1枚廃棄し、エネルギー+3、2ドロー",
    effect: { exhaustOneFromHand: true, energy: 3, draw: 2 },
    diffText: "エネルギー+1"
  },
  secondWind: {
    text: "手札の非アタックカードを全廃棄し、1枚につき7ブロック",
    effect: { exhaustNonAttackAndGainBlock: 7 },
    diffText: "1枚あたり+2ブロック"
  },
  feed: {
    text: "敵を倒すたびにHP+5",
    effect: { grantPower: "feed" },
    feedHealBonus: 5,
    diffText: "撃破時回復+2"
  },
  demonForm: {
    text: "毎ターン開始時に筋力+3",
    effect: { grantPower: "demonForm" },
    demonFormGain: 3,
    diffText: "毎ターン筋力+1"
  },
  barricade: {
    cost: 2,
    text: "ブロックがターン終了時に消えない",
    effect: { grantPower: "barricade" },
    diffText: "コスト-1"
  }
};

// スターターデッキのカードIDリスト（文字列）
function createStarterDeckIds() {
  return [
    "strike", "strike", "strike", "strike", "strike",
    "defend", "defend", "defend", "defend",
    "bash"
  ];
}

module.exports = { CARD_LIBRARY, CARD_UPGRADE_LIBRARY, createStarterDeckIds };
