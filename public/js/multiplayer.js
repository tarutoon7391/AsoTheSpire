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
  // 直前に受信した game_state_update のフェーズを保持する。
  // selecting への遷移が「enemy_turn → selecting」かどうかを判定するために使用する。
  var prevPhase = null;

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

      // game.js のバトルを開始しない（マルチモードではサーバー側でゲームを管理する）
      // ページリダイレクト後に新しいsocketがroomに参加できるよう join_room を再送する
      var session = loadMultiSession();
      if (session.roomId && session.playerName) {
        joinRoom(session.roomId, session.playerName);
      }
      // サーバーへ battle_start イベントを送信してサーバー側でゲームに接続する
      startBattle();
      // クライアント側の初期表示（手札・山札・敵HP等）を初期化するために
      // ソロのsetupBattle()相当の処理も呼び出す
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

  // --- battle_redirect 受信時のリダイレクト処理 ---
  socket.on("battle_redirect", function (data) {
    if (data && data.redirect) {
      // すでに同じページにいる場合は再リダイレクトしない（再接続時の無限ループを防ぐ）
      var targetPath = data.redirect.split("?")[0];
      if (window.location.pathname === targetPath) {
        return;
      }
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

    // バグ③修正: 敵情報をプレイヤー情報より先に window.gameState に反映し、
    // その後にプレイヤー情報を反映してから render() を呼ぶ順序を保証する。
    // サーバーの敵情報をソロのgameStateに反映する（先に反映する）
    if (gameState.enemy && window.gameState) {
      window.gameState.enemy.hp = gameState.enemy.hp;
      window.gameState.enemy.maxHp = gameState.enemy.maxHp;
      window.gameState.enemy.block = gameState.enemy.block;
      window.gameState.enemy.intent = gameState.enemy.intent;
      window.gameState.enemy.status = gameState.enemy.status;
    }
    // サーバーから受け取った自分のプレイヤーデータをソロのgameStateに反映して画面を更新する
    var myPlayer = gameState.players ? gameState.players[socket.id] : null;
    if (myPlayer && window.gameState) {
      window.gameState.player.hp = myPlayer.hp;
      window.gameState.player.maxHp = myPlayer.maxHp;
      window.gameState.player.block = myPlayer.block;
      window.gameState.player.energy = myPlayer.energy;
      // 手札をサーバーのカードIDリストからオブジェクト形式に変換して反映する
      if (Array.isArray(myPlayer.hand)) {
        window.gameState.player.hand = myPlayer.hand.map(function (cardId) {
          return { id: cardId, upgraded: false };
        });
      }
      // ステータス効果（毒・筋力など）を反映する
      if (myPlayer.status && typeof myPlayer.status === "object" && window.gameState.player.status) {
        Object.assign(window.gameState.player.status, myPlayer.status);
      }
      // 山札・捨て札の枚数を反映する（render()での枚数表示に使用）
      if (typeof myPlayer.deckCount === "number") {
        window.gameState.player.drawPile = new Array(myPlayer.deckCount);
      }
      if (typeof myPlayer.discardCount === "number") {
        window.gameState.player.discardPile = new Array(myPlayer.discardCount);
      }
    }
    // 敵・プレイヤー反映後に render() を呼んで画面を更新する
    if (typeof window.render === "function") {
      window.render();
    }

    var endTurnBtn = document.getElementById("endTurnButton");

    if (gameState.phase === "selecting") {
      // バグ②修正: 直前のphaseが 'enemy_turn' のとき（＝新しいターン開始時）のみ
      // endTurnSent をリセットしてターン終了ボタンを再活性化する。
      // それ以外の selecting 遷移（カード選択直後など）ではボタン状態を変更しない。
      if (prevPhase === "enemy_turn") {
        if (endTurnBtn) {
          endTurnSent = false;
          endTurnBtn.disabled = false;
          endTurnBtn.textContent = "ターン終了";
        }
        // 新しいターン開始時のみ手札の選択状態をリセットする
        var hand = document.getElementById("hand");
        if (hand) {
          hand.querySelectorAll(".hand-card.selected").forEach(function (c) {
            c.classList.remove("selected");
          });
        }
      }
    } else if (gameState.phase === "resolving" || gameState.phase === "enemy_turn") {
      // 解決フェーズ・敵ターン: ターン終了ボタンを非活性にする
      if (endTurnBtn) {
        endTurnBtn.disabled = true;
      }
    } else if (gameState.phase === "finished") {
      // 終了フェーズ: ターン終了ボタンを非活性にする
      if (endTurnBtn) {
        endTurnBtn.disabled = true;
      }
    }

    // 次回判定用に現在のフェーズを保持する
    prevPhase = gameState.phase;
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

    Object.keys(players).forEach(function (socketId) {
      var p = players[socketId];
      var isReady = readyPlayers.indexOf(socketId) !== -1;
      var isSelf = socketId === socket.id;
      var entry = document.createElement("div");
      entry.className = "multi-player-entry";

      var name = document.createElement("span");
      name.className = "multi-player-name";
      // バグ①修正: 自分自身（socket.id 一致）のエントリには「自分」と表示し、
      // 相手のエントリには相手のプレイヤー名を表示する。socket.id で識別する。
      if (isSelf) {
        name.textContent = "自分";
      } else {
        name.textContent = p.name || socketId;
      }
      entry.appendChild(name);

      // 準備完了ならチェックマークを表示する
      if (isReady) {
        var check = document.createElement("span");
        check.className = "multi-player-ready";
        check.textContent = " ✔";
        entry.appendChild(check);
      }

      // HP: 現在値 / 最大値 形式で表示する
      var info = document.createElement("span");
      var blockText = (p.block || 0) > 0 ? " 🛡 " + (p.block || 0) : "";
      info.textContent = " HP: " + (p.hp || 0) + " / " + (p.maxHp || 0) + blockText;
      entry.appendChild(info);

      listEl.appendChild(entry);
    });
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

  // battle_start を送信してゲーム開始を通知する（roomId・playerName は内部保持値を使用）
  function startBattle() {
    var session = loadMultiSession();
    socket.emit("battle_start", { roomId: currentRoomId, playerName: session.playerName });
  }

  // select_card を送信する（roomId は内部保持値を使用）
  function sendSelectCard(cardId) {
    socket.emit("select_card", { roomId: currentRoomId, cardId: cardId });
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
    sendEndTurn
  };
})();

