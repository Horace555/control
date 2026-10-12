(() => {
  "use strict";

  const BROKER_URL = "wss://broker.emqx.io:8084/mqtt";
  const TOPIC = "w6";
  const STORAGE_PREFIX = "mqtt-voice-light-payload-";
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const connectionCard = document.getElementById("connection-card");
  const connectionTitle = document.getElementById("connection-title");
  const connectionDetail = document.getElementById("connection-detail");
  const voicePanel = document.querySelector(".voice-panel");
  const voiceButton = document.getElementById("voice-button");
  const voiceButtonLabel = document.getElementById("voice-button-label");
  const voiceStatus = document.getElementById("voice-status");
  const heardText = document.getElementById("heard-text");
  const lastPublished = document.getElementById("last-published");
  const inputs = [1, 2, 3].map((number) => document.getElementById(`payload-${number}`));
  const buttons = [1, 2, 3].map((number) => document.querySelector(`[data-send="${number}"]`));
  const feedbacks = [1, 2, 3].map((number) => document.querySelector(`[data-feedback="${number}"]`));

  let client;
  let connected = false;
  let recognition;
  let wantsListening = false;
  let listening = false;
  let restartTimer;
  let seenResults = new Set();

  function setConnection(state, title, detail) {
    connectionCard.dataset.state = state;
    connectionTitle.textContent = title;
    connectionDetail.textContent = detail;
    connected = state === "connected";
    buttons.forEach((button) => { button.disabled = !connected; });
    if (!connected) {
      feedbacks.forEach((feedback) => {
        if (feedback.dataset.kind !== "error") {
          feedback.textContent = "等待 MQTT 連線";
          feedback.dataset.kind = "idle";
        }
      });
    }
  }

  function setFeedback(number, message, kind = "idle") {
    const element = feedbacks[number - 1];
    element.textContent = message;
    element.dataset.kind = kind;
  }

  function savePayload(number, value) {
    try { localStorage.setItem(`${STORAGE_PREFIX}${number}`, value); } catch { /* Storage can be disabled. */ }
  }

  function restorePayload(number) {
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}${number}`);
      if (saved !== null) inputs[number - 1].value = saved;
    } catch { /* Keep the HTML default. */ }
  }

  function publish(number, source) {
    const input = inputs[number - 1];
    const payload = input.value.trim();
    if (!connected || !client) {
      setFeedback(number, "目前未連線，訊息未發送", "error");
      return;
    }
    if (!payload) {
      setFeedback(number, "請先填寫發送內容", "error");
      input.focus();
      return;
    }
    buttons[number - 1].disabled = true;
    setFeedback(number, "正在發送…");
    try {
      client.publish(TOPIC, payload, { qos: 0, retain: false }, (error) => {
        buttons[number - 1].disabled = !connected;
        if (error) {
          setFeedback(number, "發送失敗，請重試", "error");
          return;
        }
        const time = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
        setFeedback(number, `${time} · 已發送`, "success");
        lastPublished.textContent = `${time} · ${source === "voice" ? "語音" : "按鈕"} · 燈泡 ${number} → w6 · ${payload}`;
      });
    } catch {
      buttons[number - 1].disabled = !connected;
      setFeedback(number, "發送失敗，請重試", "error");
    }
  }

  function parseCommand(transcript) {
    const cleaned = transcript.normalize("NFKC")
      .replace(/[\s，。！？、,!.?：:;；「」『』"']/g, "")
      .replaceAll("帮", "幫").replaceAll("开", "開").replaceAll("灯", "燈");
    const match = cleaned.match(/^(?:請)?(?:幫我)?(?:打開|開啟|開)燈泡([123一二三])$/);
    if (!match) return null;
    return { "一": 1, "二": 2, "三": 3 }[match[1]] || Number(match[1]);
  }

  function renderVoice() {
    voicePanel.classList.toggle("is-listening", listening);
    voiceButton.setAttribute("aria-pressed", String(wantsListening));
    voiceButtonLabel.textContent = wantsListening ? "停止語音控制" : "開始語音控制";
  }

  function stopVoice(message = "語音控制已停止。") {
    wantsListening = false;
    clearTimeout(restartTimer);
    voiceStatus.textContent = message;
    if (recognition && listening) recognition.stop();
    renderVoice();
  }

  function startRecognition() {
    if (!wantsListening || !recognition || listening) return;
    try { recognition.start(); }
    catch (error) {
      if (error.name !== "InvalidStateError") stopVoice("無法啟動麥克風，請確認瀏覽器權限。");
    }
  }

  function setupSpeech() {
    if (!SpeechRecognition) {
      voiceButton.disabled = true;
      voiceStatus.textContent = "此瀏覽器不支援語音辨識，仍可使用下方按鈕。";
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = "zh-TW";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      listening = true;
      seenResults = new Set();
      voiceStatus.textContent = "正在聆聽…請說「幫我打開燈泡1」等指令。";
      renderVoice();
    };
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result.isFinal) {
          heardText.textContent = result[0].transcript.trim() || "正在辨識…";
          continue;
        }
        if (seenResults.has(index)) continue;
        seenResults.add(index);
        const transcript = result[0].transcript.trim();
        heardText.textContent = transcript || "尚無辨識內容";
        let number = null;
        for (let alternative = 0; alternative < result.length; alternative += 1) {
          number = parseCommand(result[alternative].transcript);
          if (number) break;
        }
        if (!number) {
          voiceStatus.textContent = "沒有對應的燈泡指令，請再說一次。";
        } else if (!connected) {
          voiceStatus.textContent = `聽到燈泡 ${number}，但 MQTT 尚未連線，訊息未發送。`;
        } else {
          voiceStatus.textContent = `聽到燈泡 ${number}，正在發送。`;
          publish(number, "voice");
        }
      }
    };
    recognition.onerror = (event) => {
      const descriptions = {
        "not-allowed": "麥克風權限遭拒，請在瀏覽器允許麥克風。",
        "service-not-allowed": "語音辨識服務無法使用。",
        "audio-capture": "找不到可用的麥克風。",
        "network": "語音辨識網路連線失敗，請稍後重試。"
      };
      if (event.error === "no-speech") {
        voiceStatus.textContent = "沒有聽到語音，正在重新聆聽…";
        return;
      }
      stopVoice(descriptions[event.error] || `語音辨識失敗：${event.error}`);
    };
    recognition.onend = () => {
      listening = false;
      renderVoice();
      if (wantsListening) restartTimer = setTimeout(startRecognition, 700);
    };
    voiceButton.addEventListener("click", () => {
      if (wantsListening) {
        stopVoice();
      } else {
        wantsListening = true;
        voiceStatus.textContent = "正在啟動麥克風…";
        renderVoice();
        startRecognition();
      }
    });
  }

  function connectMqtt() {
    if (!window.mqtt || typeof window.mqtt.connect !== "function") {
      setConnection("error", "無法載入 MQTT", "請確認網路連線，然後重新整理頁面。");
      return;
    }
    const id = `voice_light_${Math.random().toString(16).slice(2, 10)}`;
    try {
      client = window.mqtt.connect(BROKER_URL, {
        clientId: id,
        clean: true,
        reconnectPeriod: 3000,
        queueQoSZero: false,
        connectTimeout: 10000,
        keepalive: 30,
        protocolVersion: 4
      });
      client.on("connect", () => {
        setConnection("connected", "已連線", "可以發送燈泡指令。連線中斷時會自動重連。");
      });
      client.on("reconnect", () => setConnection("connecting", "重新連線中", "正在重新連接 broker.emqx.io…"));
      client.on("offline", () => setConnection("offline", "目前離線", "連線中斷，正在等待自動重連。"));
      client.on("close", () => {
        if (connected) setConnection("offline", "連線已中斷", "正在等待自動重連。");
      });
      client.on("error", () => setConnection("error", "連線發生問題", "請確認網路；系統會自動重試。"));
    } catch {
      setConnection("error", "連線失敗", "無法建立 MQTT 連線，請重新整理頁面。");
    }
  }

  inputs.forEach((input, index) => {
    const number = index + 1;
    restorePayload(number);
    input.addEventListener("input", () => savePayload(number, input.value));
    buttons[index].addEventListener("click", () => publish(number, "button"));
  });
  setupSpeech();
  connectMqtt();
})();

