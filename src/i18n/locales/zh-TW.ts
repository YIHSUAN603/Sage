// 基準語言檔：所有 key 以此為準（其他 locale 用 `satisfies typeof zhTW` 對齊）。
// `ui` = 介面文字；`prompt` = 送給 LLM 的 system prompt / 訊息模板。
export default {
  ui: {
    composer: {
      noKey: "還沒有 OpenRouter API key，{{name}} 說不了話。",
      openSettings: "打開設定貼上 key",
      placeholder: "跟 {{name}} 說點什麼…",
      inputAria: "訊息輸入",
      stop: "停止回應",
      sendTitle: "送出（Enter）",
      send: "送出",
    },
    messages: {
      greeting1: "嗨，我是 {{name}}。",
      greeting2: "想聊什麼，或有想讓我讀的檔案嗎？",
    },
    toolCard: {
      running: "執行中…",
      tool: "工具",
      args: "參數",
      result: "回傳",
      noResult: "（還沒有結果）",
    },
    chat: {
      settingsTitle: "設定",
      hide: "收起",
      dismissError: "關閉錯誤訊息",
    },
    avatar: {
      observing: "觀察中——點一下暫停（重新開啟請到設定）",
      pauseObserve: "暫停觀察",
      devTest: "測試冒泡（dev 限定）：點=立刻截圖問模型一次；Shift+點=直接出假氣泡",
      devTestAria: "測試冒泡",
      toggleChat: "開關對話氣泡",
      sprite: "點一下跟 {{name}} 聊天，按住拖拉移動",
    },
    bubble: {
      close: "關閉冒泡",
    },
    settings: {
      title: "設定",
      chatModel: "聊天模型（必填，需支援 tools）",
      chatModelPlaceholder: "點一下從清單挑選，或直接填 model id",
      modelsError:
        "模型清單載入失敗——請自行填入 OpenRouter model id（例：google/gemma-4-26b-a4b-it:free）。",
      recommended: "（推薦：tools+vision 通吃）",
      observeModel: "觀察模型（需支援圖片輸入）",
      observeModelPlaceholder: "可與聊天模型相同",
      observeEnable: "開啟觀察（預設關閉）",
      interval: "間隔",
      seconds: "秒",
      language: "語言",
      languageAuto: "跟隨系統",
      companion: "夥伴",
      companionBuiltin: "內建 Sage",
      importPet: "匯入寵物…",
      importing: "匯入中…",
      importError: "匯入失敗——請選一個含 pet.json 與 spritesheet 的寵物資料夾。",
      privacyNote:
        "觀察開啟後，Sage 會定期讀取目前視窗標題，必要時擷取螢幕縮圖送往 OpenRouter 判斷「有沒有值得一提的事」。截圖只在記憶體中處理、送出後即丟棄，不會存檔；關閉觀察即完全停止一切擷取與上傳。",
      cancel: "取消",
      save: "儲存",
      saving: "儲存中…",
    },
    errors: {
      noChatModel:
        "尚未選擇聊天模型——請開啟設定（⚙），在「聊天模型」挑一個或填入 OpenRouter model id。",
      auth: "API key 無效或未授權（401）——請到設定檢查 OpenRouter key。",
      rateLimit: "額度或速率已達上限（429）——休息一下再試。",
      network: "網路連線失敗：{{message}}",
    },
  },
  prompt: {
    persona: {
      default:
        "你是桌面上的小夥伴 Sage，像朋友一樣陪著使用者工作。你不是提醒或指導他的助理，語氣像朋友一樣自然、不說教。",
      synthBase:
        "你是使用者桌面上的小夥伴「{{name}}」，像朋友一樣陪著使用者工作，語氣自然、不說教。",
    },
    gate: {
      protocol:
        "你偶爾會看到使用者目前的工作脈絡。看到有趣或值得一提的觀察時，就用繁體中文隨口聊一句；就算沒什麼特別的觀察，偶爾也可以搭句話、閒聊或打打氣，讓他工作時有人陪、不無聊。但不用每次都講話，如果這個當下你沒什麼想說的，就只回覆 SILENT，別硬找話說，也不要輸出任何其他文字。開口時控制在 50 字以內。",
      trigger: "觸發原因：{{reason}}",
      recentActivity: "最近的視窗活動（新到舊）：",
      withScreenshot: "（附上目前的螢幕縮圖）",
      noScreenshot: "（無法取得螢幕截圖，只有視窗標題可參考）",
      forceAskReason: "使用者主動詢問目前脈絡",
      observeReason: "定期看看使用者現在在忙什麼",
    },
    context: {
      intro:
        "（背景脈絡：使用者已授權 Sage 觀察桌面。以下是最近的視窗活動，回答時可自然地參考，但不必主動逐條複述。）",
      line: "- {{label}}：{{app}} — {{title}}（{{dwell}}）",
      current: "目前",
      earlier: "稍早",
      underMinute: "不到 1 分鐘",
      minutes: "約 {{count}} 分鐘",
    },
  },
};
