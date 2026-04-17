// Socket.io クライアント初期化・ルーム送受信・マルチプレイ UI 制御
// URLパラメータ ?mode=multi が付いている場合のみマルチ処理を有効にする

(function createMultiplayerModule() {
  // Socket.io クライアントを初期化する（サーバーと同一オリジンへ接続）
  const socket = io();

  // --- セーブデータマイグレーション ---
  // localStorage に保存されたマルチプレイセッション情報を読み込み、
  // 新たに追加されたフィールドが存在しない場合はデフォルト値で補完する
  function loadMultiSession() {
    var savedData = null;
    try {
      savedData = localStorage.getItem("multiSession");
    } catch (e) {
      // localStorage が利用できない環境ではデフォルト値を返す
    }
    var defaults = { roomId: "", playerName: "" };
    if (!savedData) {
      return defaults;
    }
    var data;
    try {
      data = JSON.parse(savedData);
    } catch (e) {
      return defaults;
    }
    // フィールドが存在しない場合はデフォルト値で補完する（マイグレーション）
    return {
      roomId: typeof data.roomId === "string" ? data.roomId : defaults.roomId,
      playerName: typeof data.playerName === "string" ? data.playerName : defaults.playerName
    };
  }

  function saveMultiSession(roomId, playerName) {
    try {
      localStorage.setItem("multiSession", JSON.stringify({ roomId: roomId, playerName: playerName }));
    } catch (e) {
      // 保存失敗は無視する
    }
  }

  // --- 内部状態 ---
  var currentRoomId = "";
  var isMultiMode = false;
  var endTurnSent = false;

  // URLパラメータ ?mode=multi の判定
  (function detectMode() {
    var params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "multi") {
      isMultiMode = true;
      var session = loadMultiSession();
      currentRoomId = session.roomId;
    }
  })();

  // --- マルチモード UI 初期化 ---
  if (isMultiMode) {
    document.addEventListener("DOMContentLoaded", function () {
      // マップ画面を非表示にしてバトル画面を表示する
      var screenMap = document.getElementById("screen-map");
      var screenBattle = document.getElementById("screen-battle");
      if (screenMap) {
        screenMap.classList.add("hidden");
      }
      if (screenBattle) {
        screenBattle.classList.remove("hidden");
      }

      // マルチプレイヤーパネルを表示する
      var playersPanel = document.getElementById("multi-players-panel");
      if (playersPanel) {
        playersPanel.classList.remove("hidden");
      }

      // 敵情報パネルを表示する
      var enemyPanel = document.getElementById("multi-enemy-panel");
      if (enemyPanel) {
        enemyPanel.classList.remove("hidden");
      }

      // ターン終了ボタン（#endTurnButton）にマルチ用のハンドラを追加する
      var endTurnBtn = document.getElementById("endTurnButton");
      if (endTurnBtn) {
        endTurnBtn.addEventListener("click", function () {
          if (endTurnSent) {
            return;
          }
          handleEndTurn();
        });
      }

      // 準備完了ボタンのクリック処理を登録する
      var readyBtn = document.getElementById("multi-ready-btn");
      if (readyBtn) {
        readyBtn.addEventListener("click", function () {
          handleReadyButton();
        });
      }

      // 手札へのカード選択クリックハンドラを登録する（MutationObserver で動的追加に対応）
      var hand = document.getElementById("hand");
      if (hand) {
        hand.addEventListener("click", function (event) {
          var card = event.target.closest(".hand-card");
          if (!card) {
            return;
          }
          // 同じカードをクリックしたら選択解除、別のカードをクリックしたら選択を切り替える
          var isSelected = card.classList.contains("selected");
          // すべての手札カードの selected クラスをリセットする
          hand.querySelectorAll(".hand-card").forEach(function (c) {
            c.classList.remove("selected");
          });
          if (!isSelected) {
            card.classList.add("selected");
          }
        });
      }

      // game.js のバトルを開始してデモ用手札を準備する
      if (window.BattleAPI && typeof window.BattleAPI.startBattle === "function") {
        window.BattleAPI.startBattle(50);
      }
    });
  }

  // --- ターン終了ボタンの処理 ---
  function handleEndTurn() {
    endTurnSent = true;
    sendEndTurn();

    var endTurnBtn = document.getElementById("endTurnButton");
    if (endTurnBtn) {
      endTurnBtn.disabled = true;
      endTurnBtn.textContent = "他のプレイヤーを待っています...";
    }
  }

  // --- 準備完了ボタンの処理 ---
  function handleReadyButton() {
    var hand = document.getElementById("hand");
    var selectedCard = hand ? hand.querySelector(".hand-card.selected") : null;
    var cardId = selectedCard ? selectedCard.dataset.cardId || selectedCard.dataset.handKey || "" : "";

    // data-card-id 属性からカード ID を取得する（手札カードの属性名に合わせる）
    if (selectedCard) {
      // hand-key 形式: "{index}-{cardId}-{u|n}" からカード ID を取り出す
      var key = selectedCard.dataset.handKey || "";
      var parts = key.split("-");
      if (parts.length >= 2) {
        cardId = parts[1];
      }
    }

    if (cardId) {
      sendSelectCard(cardId);
    }
    sendPlayerReady();

    // ボタンを非活性にして待機メッセージを表示する
    var readyBtn = document.getElementById("multi-ready-btn");
    if (readyBtn) {
      readyBtn.disabled = true;
    }
    var waitingMsg = document.getElementById("multi-waiting-msg");
    if (waitingMsg) {
      waitingMsg.classList.remove("hidden");
    }
  }

  // --- battle_redirect 受信時のリダイレクト処理 ---
  socket.on("battle_redirect", function (data) {
    if (data && data.redirect) {
      window.location.href = data.redirect;
    }
  });

  // --- game_state_update 受信時の UI 更新 ---
  socket.on("game_state_update", function (gameState) {
    console.log("[game_state_update]", JSON.stringify(gameState, null, 2));

    if (!isMultiMode) {
      return;
    }

    // multi-players-panel に全プレイヤーの HP・ブロックを表示する
    updatePlayersPanel(gameState);

    // 敵情報パネルを更新する
    updateEnemyPanel(gameState);

    var overlay = document.getElementById("multi-overlay");
    var waitingMsg = document.getElementById("multi-waiting-msg");
    var resultArea = document.getElementById("multi-result-area");
    var readyBtn = document.getElementById("multi-ready-btn");
    var endTurnBtn = document.getElementById("endTurnButton");

    if (gameState.phase === "selecting") {
      // カード選択フェーズ: オーバーレイを表示して選択を促す
      if (overlay) {
        overlay.classList.remove("hidden");
      }
      if (waitingMsg) {
        waitingMsg.classList.add("hidden");
      }
      if (resultArea) {
        resultArea.classList.add("hidden");
        resultArea.textContent = "";
      }
      if (readyBtn) {
        readyBtn.disabled = false;
      }
      // ターン終了ボタンを再活性化する
      if (endTurnBtn) {
        endTurnSent = false;
        endTurnBtn.disabled = false;
        endTurnBtn.textContent = "ターン終了";
      }
      // 手札の選択状態をリセットする
      var hand = document.getElementById("hand");
      if (hand) {
        hand.querySelectorAll(".hand-card.selected").forEach(function (c) {
          c.classList.remove("selected");
        });
      }
    } else if (gameState.phase === "resolving") {
      // 解決フェーズ: 待機メッセージを非表示にして「解決中...」を表示する
      if (waitingMsg) {
        waitingMsg.classList.add("hidden");
      }
      if (resultArea) {
        resultArea.classList.remove("hidden");
        resultArea.textContent = "解決中...";
      }
    } else if (gameState.phase === "finished") {
      // 終了フェーズ: ゲーム結果を表示する
      if (overlay) {
        overlay.classList.remove("hidden");
      }
      if (resultArea) {
        resultArea.classList.remove("hidden");
        var enemy = gameState.enemy || {};
        if (enemy.hp <= 0) {
          resultArea.textContent = "🎉 勝利！敵を倒しました！";
        } else {
          resultArea.textContent = "💀 ゲームオーバー";
        }
      }
      if (readyBtn) {
        readyBtn.disabled = true;
      }
      if (endTurnBtn) {
        endTurnBtn.disabled = true;
      }
    } else if (gameState.phase === "enemy_turn") {
      // 敵のターン: 待機メッセージを非表示にして結果を表示する
      if (waitingMsg) {
        waitingMsg.classList.add("hidden");
      }
      if (resultArea) {
        resultArea.classList.remove("hidden");
        resultArea.textContent = "敵のターン中...";
      }
    }
  });

  // --- プレイヤーパネルの更新 ---
  function updatePlayersPanel(gameState) {
    var listEl = document.getElementById("multi-players-list");
    if (!listEl) {
      return;
    }
    listEl.innerHTML = "";
    var players = gameState.players || {};
    var readyPlayers = gameState.readyPlayers || [];
    var readyCount = gameState.readyCount !== undefined ? gameState.readyCount : readyPlayers.length;
    var totalPlayers = gameState.totalPlayers !== undefined ? gameState.totalPlayers : Object.keys(players).length;

    // ターン終了ボタンの待機テキストを人数に合わせて更新する
    var endTurnBtn = document.getElementById("endTurnButton");
    if (endTurnBtn && endTurnSent) {
      endTurnBtn.textContent = "他のプレイヤーを待っています (" + readyCount + "/" + totalPlayers + ")";
    }

    // 待機メッセージに人数を反映する
    var waitingMsg = document.getElementById("multi-waiting-msg");
    if (waitingMsg) {
      waitingMsg.textContent = "他のプレイヤーを待っています... (" + readyCount + "/" + totalPlayers + ")";
    }

    Object.keys(players).forEach(function (socketId) {
      var p = players[socketId];
      var isReady = readyPlayers.indexOf(socketId) !== -1;
      var entry = document.createElement("div");
      entry.className = "multi-player-entry";
      var name = document.createElement("span");
      name.className = "multi-player-name";
      name.textContent = p.name || socketId;
      entry.appendChild(name);
      // 準備完了ならチェックマークを表示する
      if (isReady) {
        var check = document.createElement("span");
        check.className = "multi-player-ready";
        check.textContent = " ✔";
        entry.appendChild(check);
      }
      var info = document.createElement("span");
      info.textContent = " HP:" + (p.hp || 0) + "/" + (p.maxHp || 0) + " ブロック:" + (p.block || 0);
      entry.appendChild(info);
      listEl.appendChild(entry);
    });
  }

  // --- 敵情報パネルの更新 ---
  function updateEnemyPanel(gameState) {
    var enemy = gameState.enemy;
    if (!enemy) {
      return;
    }
    var hpEl = document.getElementById("multi-enemy-hp");
    var blockEl = document.getElementById("multi-enemy-block");
    var intentEl = document.getElementById("multi-enemy-intent");
    if (hpEl) {
      hpEl.textContent = "HP: " + (enemy.hp || 0) + " / " + (enemy.maxHp || 0);
    }
    if (blockEl) {
      blockEl.textContent = "ブロック: " + (enemy.block || 0);
    }
    if (intentEl && enemy.intent) {
      var intentText;
      if (enemy.intent.type === "attack") {
        intentText = "⚔ 攻撃: " + enemy.intent.value + " ダメージ";
      } else if (enemy.intent.type === "block") {
        intentText = "🛡 ブロック: " + enemy.intent.value;
      } else {
        intentText = enemy.intent.type;
      }
      intentEl.textContent = "次の行動: " + intentText;
    }
  }

  // --- API 公開関数 ---

  // join_room を送信して roomId・playerName を localStorage に保存する
  function joinRoom(roomId, playerName) {
    saveMultiSession(roomId, playerName);
    currentRoomId = roomId;
    socket.emit("join_room", { roomId: roomId, playerName: playerName });
  }

  // room_update を受信したときのコールバックを登録する
  function onRoomUpdate(callback) {
    socket.on("room_update", callback);
  }

  // join_error を受信したときのコールバックを登録する
  function onJoinError(callback) {
    socket.on("join_error", callback);
  }

  // battle_start を送信してゲーム開始を通知する（roomId は内部保持値を使用）
  function startBattle() {
    socket.emit("battle_start", { roomId: currentRoomId });
  }

  // select_card を送信する（roomId は内部保持値を使用）
  function sendSelectCard(cardId) {
    socket.emit("select_card", { roomId: currentRoomId, cardId: cardId });
  }

  // player_ready を送信する（roomId は内部保持値を使用）
  function sendPlayerReady() {
    socket.emit("player_ready", { roomId: currentRoomId });
  }

  // end_turn を送信する（roomId は内部保持値を使用）
  function sendEndTurn() {
    socket.emit("end_turn", { roomId: currentRoomId });
  }

  window.MultiplayerAPI = {
    joinRoom,
    onRoomUpdate,
    onJoinError,
    startBattle,
    sendSelectCard,
    sendPlayerReady,
    sendEndTurn
  };
})();

