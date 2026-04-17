// マップ進行を管理する
(function createMapModule() {
  const elements = {
    screenMap: document.getElementById("screen-map"),
    screenBattle: document.getElementById("screen-battle"),
    screenShop: document.getElementById("screen-shop"),
    mapRooms: document.getElementById("mapRooms"),
    mapPlayerHp: document.getElementById("mapPlayerHp"),
    mapGold: document.getElementById("mapGold"),
    mapBattleCount: document.getElementById("mapBattleCount"),

    restOverlay: document.getElementById("restOverlay"),
    restHealButton: document.getElementById("restHealButton"),
    restSmithButton: document.getElementById("restSmithButton"),
    restCloseButton: document.getElementById("restCloseButton"),

    smithOverlay: document.getElementById("smithOverlay"),
    smithDeckList: document.getElementById("smithDeckList"),
    closeSmithButton: document.getElementById("closeSmithButton"),

    smithCompareOverlay: document.getElementById("smithCompareOverlay"),
    smithBeforeCard: document.getElementById("smithBeforeCard"),
    smithAfterCard: document.getElementById("smithAfterCard"),
    smithDiffText: document.getElementById("smithDiffText"),
    confirmSmithButton: document.getElementById("confirmSmithButton"),
    cancelSmithButton: document.getElementById("cancelSmithButton"),

    runEndOverlay: document.getElementById("runEndOverlay"),
    runEndTitle: document.getElementById("runEndTitle"),
    runEndBattleCount: document.getElementById("runEndBattleCount"),
    runEndHp: document.getElementById("runEndHp"),
    restartRunButton: document.getElementById("restartRunButton")
  };

  const ROOM_ICON = {
    battle: "⚔️",
    rest: "🔥",
    shop: "💰",
    boss: "💀"
  };

  const mapState = {
    rooms: [],
    currentRoomIndex: -1,
    pendingRestRoomIndex: -1,
    selectedSmithCardIndex: -1,
    battleCount: 0,
    gold: 100,
    winGoldReserved: 0
  };

  // 画面を切り替える
  function switchScreen(screenId) {
    elements.screenMap.classList.add("hidden");
    elements.screenBattle.classList.add("hidden");
    elements.screenShop.classList.add("hidden");

    if (screenId === "map") {
      elements.screenMap.classList.remove("hidden");
    } else if (screenId === "battle") {
      elements.screenBattle.classList.remove("hidden");
    } else if (screenId === "shop") {
      elements.screenShop.classList.remove("hidden");
    }
  }

  // 部屋タイプをランダム抽選する
  function rollRoomType(previousType) {
    const value = Math.floor(Math.random() * 100) + 1;
    let selected = "battle";

    if (value <= 60) {
      selected = "battle";
    } else if (value <= 80) {
      selected = "rest";
    } else {
      selected = "shop";
    }

    if (selected === "rest" && previousType === "rest") {
      return Math.random() < 0.5 ? "battle" : "shop";
    }

    return selected;
  }

  // 一本道15部屋マップを生成する
  function generateMap() {
    const rooms = [];

    for (let roomNumber = 1; roomNumber <= 15; roomNumber += 1) {
      let type = "battle";

      if (roomNumber === 1) {
        type = "battle";
      } else if (roomNumber === 15) {
        type = "boss";
      } else {
        const prevType = rooms[rooms.length - 1].type;
        type = rollRoomType(prevType);
      }

      rooms.push({
        number: roomNumber,
        type,
        cleared: false
      });
    }

    return rooms;
  }

  // マップ上部ステータスを更新する
  function renderRunStatus() {
    const playerState = window.BattleAPI.getPlayerState();
    elements.mapPlayerHp.textContent = `${playerState.hp} / ${playerState.maxHp}`;
    elements.mapGold.textContent = String(mapState.gold);
    elements.mapBattleCount.textContent = String(mapState.battleCount);
  }

  // マップ見た目を描画する
  function renderMap() {
    elements.mapRooms.innerHTML = "";

    const nextRoomIndex = mapState.currentRoomIndex + 1;
    const reversedRooms = [...mapState.rooms].reverse();

    reversedRooms.forEach((room) => {
      const roomIndex = room.number - 1;
      const isCleared = roomIndex <= mapState.currentRoomIndex;
      const isCurrent = roomIndex === mapState.currentRoomIndex;
      const isNext = roomIndex === nextRoomIndex;

      const wrap = document.createElement("div");
      wrap.className = "map-room-wrap";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-room";
      button.innerHTML = `<span>${ROOM_ICON[room.type]}</span><span>${room.number}</span>`;

      if (isCleared) {
        button.classList.add("map-room--cleared");
      }
      if (isCurrent) {
        button.classList.add("map-room--current");
      }
      if (isNext) {
        button.classList.add("map-room--next");
      }

      button.disabled = !isNext;
      button.addEventListener("click", () => {
        enterRoom(roomIndex);
      });

      wrap.appendChild(button);
      elements.mapRooms.appendChild(wrap);
    });

    renderRunStatus();
  }

  // カード要素を作る
  function createDeckCardElement(cardEntry) {
    const card = window.BattleAPI.getCardData(cardEntry);
    const typeMap = { "攻撃": "attack", "防御": "defense", "スキル": "skill", "パワー": "power" };

    const node = document.createElement("button");
    node.type = "button";
    node.className = `card card--${typeMap[card.type] || "skill"}`;
    node.innerHTML = `
      <div class="card-type">${card.type}</div>
      <div class="card-header">
        <span class="card-title">${card.name}${card.upgraded ? "+" : ""}</span>
        <span class="card-rarity">${card.rarity}</span>
      </div>
      <div class="card-cost-badge">${card.cost}</div>
      <div class="card-text">${card.text}</div>
    `;

    return node;
  }

  // 休憩所の鍛える一覧を描画する
  function renderSmithDeckList() {
    const deck = window.BattleAPI.getMasterDeck();
    elements.smithDeckList.innerHTML = "";

    deck.forEach((entry, index) => {
      const cardButton = createDeckCardElement(entry);
      const hasUpgradeData = Boolean(window.CARD_UPGRADE_LIBRARY[entry.id]);
      const disabled = entry.upgraded || !hasUpgradeData;

      if (disabled) {
        cardButton.classList.add("smith-card-disabled");
        cardButton.disabled = true;
      } else {
        cardButton.addEventListener("click", () => {
          mapState.selectedSmithCardIndex = index;
          openSmithCompare(entry);
        });
      }

      elements.smithDeckList.appendChild(cardButton);
    });
  }

  // 強化比較オーバーレイを開く
  function openSmithCompare(beforeEntry) {
    const afterEntry = {
      id: beforeEntry.id,
      upgraded: true
    };

    const beforeCardNode = createDeckCardElement(beforeEntry);
    const afterCardNode = createDeckCardElement(afterEntry);

    elements.smithBeforeCard.innerHTML = "";
    elements.smithAfterCard.innerHTML = "";
    elements.smithBeforeCard.appendChild(beforeCardNode);
    elements.smithAfterCard.appendChild(afterCardNode);

    const upgradeData = window.CARD_UPGRADE_LIBRARY[beforeEntry.id];
    elements.smithDiffText.textContent = upgradeData && upgradeData.diffText
      ? `+ ${upgradeData.diffText}`
      : "+ 効果が強化されます";

    elements.smithCompareOverlay.classList.remove("hidden");
  }

  // 強化比較オーバーレイを閉じる
  function closeSmithCompare() {
    elements.smithCompareOverlay.classList.add("hidden");
  }

  // 休憩所を消費してマップへ戻る
  function consumeRestRoomAndReturn() {
    const targetIndex = mapState.pendingRestRoomIndex;
    mapState.pendingRestRoomIndex = -1;

    closeRestOverlay();
    closeSmithOverlay();
    closeSmithCompare();

    mapState.currentRoomIndex = targetIndex;
    mapState.rooms[targetIndex].cleared = true;

    switchScreen("map");
    renderMap();
  }

  // 休憩所オーバーレイを開く
  function openRestOverlay(roomIndex) {
    mapState.pendingRestRoomIndex = roomIndex;
    elements.restOverlay.classList.remove("hidden");
  }

  // 休憩所オーバーレイを閉じる
  function closeRestOverlay() {
    elements.restOverlay.classList.add("hidden");
    mapState.pendingRestRoomIndex = -1;
  }

  // 鍛える一覧を開く
  function openSmithOverlay() {
    renderSmithDeckList();
    elements.smithOverlay.classList.remove("hidden");
  }

  // 鍛える一覧を閉じる
  function closeSmithOverlay() {
    elements.smithOverlay.classList.add("hidden");
    closeSmithCompare();
  }

  // ゲーム終了表示を開く
  function openRunEndOverlay(mode) {
    const playerState = window.BattleAPI.getPlayerState();

    if (mode === "clear") {
      elements.runEndTitle.textContent = "GAME CLEAR!";
      elements.runEndTitle.style.color = "#c8a96e";
    } else {
      elements.runEndTitle.textContent = "GAME OVER";
      elements.runEndTitle.style.color = "#aa4444";
    }

    elements.runEndBattleCount.textContent = String(mapState.battleCount);
    elements.runEndHp.textContent = `${playerState.hp} / ${playerState.maxHp}`;
    elements.runEndOverlay.classList.remove("hidden");
  }

  // ゲーム終了表示を閉じる
  function closeRunEndOverlay() {
    elements.runEndOverlay.classList.add("hidden");
  }

  // オーバーレイ背景クリック時の閉じる処理を登録する
  function bindOverlayBackdropClose(overlayElement, closeHandler) {
    overlayElement.addEventListener("pointerdown", (event) => {
      if (event.target === overlayElement) {
        closeHandler();
      }
    });
  }

  // マップ側オーバーレイを1つ閉じる
  function closeTopMapOverlay() {
    if (!elements.smithCompareOverlay.classList.contains("hidden")) {
      closeSmithCompare();
      return true;
    }
    if (!elements.smithOverlay.classList.contains("hidden")) {
      closeSmithOverlay();
      return true;
    }
    if (!elements.restOverlay.classList.contains("hidden")) {
      closeRestOverlay();
      return true;
    }
    if (!elements.runEndOverlay.classList.contains("hidden")) {
      closeRunEndOverlay();
      return true;
    }
    return false;
  }

  // Escでオーバーレイを閉じる
  function onGlobalKeyDown(event) {
    if (event.key !== "Escape") {
      return;
    }
    if (closeTopMapOverlay()) {
      event.preventDefault();
    }
  }

  // 戦闘勝利後の報酬完了処理
  function onBattleRewardResolved() {
    if (mapState.winGoldReserved > 0) {
      mapState.gold += mapState.winGoldReserved;
      mapState.winGoldReserved = 0;
    }

    mapState.currentRoomIndex += 1;
    mapState.rooms[mapState.currentRoomIndex].cleared = true;

    switchScreen("map");
    renderMap();
  }

  // 戦闘部屋に入る
  function startRoomBattle(room) {
    let enemyHp = 40 + room.number * 8;
    const isBoss = room.type === "boss";

    if (isBoss) {
      enemyHp = 200;
    }

    mapState.winGoldReserved = 0;

    switchScreen("battle");
    window.BattleAPI.startBattle(enemyHp, {
      isBoss,
      roomNumber: room.number,
      onBattleWin: (result) => {
        if (result.isBoss) {
          mapState.battleCount += 1;
          mapState.currentRoomIndex += 1;
          mapState.rooms[mapState.currentRoomIndex].cleared = true;
          setTimeout(() => {
            switchScreen("map");
            renderMap();
            openRunEndOverlay("clear");
          }, 500);
          return;
        }

        mapState.battleCount += 1;
        mapState.winGoldReserved = Math.floor(Math.random() * 16) + 25;
      },
      onBattleLose: () => {
        setTimeout(() => {
          switchScreen("map");
          renderMap();
          openRunEndOverlay("over");
        }, 500);
      },
      onRewardResolved: () => {
        onBattleRewardResolved();
      }
    });
  }

  // 商店に入る
  function openShopRoom(roomIndex) {
    switchScreen("shop");
    window.ShopAPI.openShop({
      currentGold: mapState.gold,
      onBuy: (payload) => {
        mapState.gold = payload.remainingGold;
        window.BattleAPI.addCardToDeck(payload.cardEntry);
      },
      onClose: (payload) => {
        mapState.gold = payload.remainingGold;
        mapState.currentRoomIndex = roomIndex;
        mapState.rooms[roomIndex].cleared = true;
        switchScreen("map");
        renderMap();
      }
    });
  }

  // 部屋へ入る
  function enterRoom(roomIndex) {
    if (roomIndex !== mapState.currentRoomIndex + 1) {
      return;
    }

    const room = mapState.rooms[roomIndex];
    if (!room) {
      return;
    }

    if (room.type === "battle" || room.type === "boss") {
      startRoomBattle(room);
      return;
    }

    if (room.type === "rest") {
      switchScreen("map");
      openRestOverlay(roomIndex);
      return;
    }

    if (room.type === "shop") {
      openShopRoom(roomIndex);
    }
  }

  // 休むボタンの処理
  function handleRestHeal() {
    const healed = window.BattleAPI.healPlayerByPercent(0.3);
    if (healed >= 0) {
      consumeRestRoomAndReturn();
    }
  }

  // 鍛える確定処理
  function handleConfirmSmith() {
    const deck = window.BattleAPI.getMasterDeck();
    const targetIndex = mapState.selectedSmithCardIndex;

    if (targetIndex < 0 || !deck[targetIndex]) {
      return;
    }

    deck[targetIndex].upgraded = true;
    window.BattleAPI.setMasterDeck(deck);
    consumeRestRoomAndReturn();
  }

  // ランを最初から開始する
  function restartRun() {
    closeRunEndOverlay();
    closeRestOverlay();
    closeSmithOverlay();
    closeSmithCompare();

    mapState.rooms = generateMap();
    mapState.currentRoomIndex = -1;
    mapState.pendingRestRoomIndex = -1;
    mapState.selectedSmithCardIndex = -1;
    mapState.battleCount = 0;
    mapState.gold = 100;
    mapState.winGoldReserved = 0;

    window.BattleAPI.resetRunState();
    switchScreen("map");
    renderMap();
  }

  // イベントを登録する
  function bindEvents() {
    elements.restHealButton.addEventListener("click", handleRestHeal);
    elements.restSmithButton.addEventListener("click", openSmithOverlay);
    elements.restCloseButton.addEventListener("click", closeRestOverlay);

    elements.closeSmithButton.addEventListener("click", closeSmithOverlay);
    elements.confirmSmithButton.addEventListener("click", handleConfirmSmith);
    elements.cancelSmithButton.addEventListener("click", closeSmithCompare);

    elements.restartRunButton.addEventListener("click", restartRun);

    bindOverlayBackdropClose(elements.restOverlay, closeRestOverlay);
    bindOverlayBackdropClose(elements.smithOverlay, closeSmithOverlay);
    bindOverlayBackdropClose(elements.smithCompareOverlay, closeSmithCompare);
    bindOverlayBackdropClose(elements.runEndOverlay, closeRunEndOverlay);

    document.addEventListener("keydown", onGlobalKeyDown);
  }

  bindEvents();
  restartRun();
})();
