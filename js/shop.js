// 商店画面を管理する
(function createShopModule() {
  const { shuffle } = window.STSUtils;

  const elements = {
    screenShop: document.getElementById("screen-shop"),
    shopGold: document.getElementById("shopGold"),
    shopCards: document.getElementById("shopCards"),
    shopNextButton: document.getElementById("shopNextButton")
  };

  const PRICE_BY_RARITY = {
    starter: 50,
    common: 50,
    uncommon: 75,
    rare: 150
  };

  let shopState = {
    currentGold: 0,
    offers: [],
    onBuy: null,
    onClose: null
  };

  // カード見た目を作る
  function createShopCard(cardId, disabled) {
    const baseCard = window.CARD_LIBRARY[cardId];
    const wrapper = document.createElement("div");
    const typeMap = { "攻撃": "attack", "防御": "defense", "スキル": "skill", "パワー": "power" };
    wrapper.className = `shop-card card card--${typeMap[baseCard.type] || "skill"}`;

    wrapper.innerHTML = `
      <div class="card-type">${baseCard.type}</div>
      <div class="card-header">
        <span class="card-title">${baseCard.name}</span>
        <span class="card-rarity">${baseCard.rarity}</span>
      </div>
      <div class="card-cost-badge">${baseCard.cost}</div>
      <div class="card-text">${baseCard.text}</div>
    `;

    if (disabled) {
      wrapper.classList.add("smith-card-disabled");
    }

    return wrapper;
  }

  // 販売候補3枚を生成する
  function generateShopOffers() {
    const pool = [...window.REWARD_POOLS.common, ...window.REWARD_POOLS.uncommon, ...window.REWARD_POOLS.rare];
    return shuffle(pool).slice(0, 3).map((cardId) => {
      const rarity = window.CARD_LIBRARY[cardId].rarity;
      return {
        cardId,
        price: PRICE_BY_RARITY[rarity] || 50,
        sold: false
      };
    });
  }

  // 商店表示を更新する
  function renderShop() {
    elements.shopGold.textContent = String(shopState.currentGold);
    elements.shopCards.innerHTML = "";

    shopState.offers.forEach((offer, offerIndex) => {
      const canBuy = !offer.sold && shopState.currentGold >= offer.price;
      const cardWrap = document.createElement("div");
      cardWrap.appendChild(createShopCard(offer.cardId, offer.sold));

      const priceText = document.createElement("p");
      priceText.className = "shop-price";
      priceText.textContent = `${offer.price}G${offer.sold ? "（売り切れ）" : ""}`;

      const buyButton = document.createElement("button");
      buyButton.type = "button";
      buyButton.textContent = offer.sold ? "購入済み" : "購入";
      buyButton.disabled = !canBuy;
      buyButton.addEventListener("click", () => {
        if (!canBuy) {
          return;
        }

        shopState.currentGold -= offer.price;
        shopState.offers[offerIndex].sold = true;

        if (typeof shopState.onBuy === "function") {
          shopState.onBuy({
            cardEntry: window.createCardInstance(offer.cardId, false),
            remainingGold: shopState.currentGold
          });
        }

        renderShop();
      });

      cardWrap.appendChild(priceText);
      cardWrap.appendChild(buyButton);
      elements.shopCards.appendChild(cardWrap);
    });
  }

  // 商店を開く
  function openShop(options) {
    shopState.currentGold = options.currentGold;
    shopState.onBuy = options.onBuy || null;
    shopState.onClose = options.onClose || null;
    shopState.offers = generateShopOffers();

    renderShop();
    elements.screenShop.classList.remove("hidden");
  }

  // 商店を閉じる
  function closeShop() {
    elements.screenShop.classList.add("hidden");
    if (typeof shopState.onClose === "function") {
      shopState.onClose({ remainingGold: shopState.currentGold });
    }
  }

  elements.shopNextButton.addEventListener("click", closeShop);

  window.ShopAPI = {
    openShop,
    closeShop
  };
})();
