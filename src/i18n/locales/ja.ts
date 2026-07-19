import type zhTW from "./zh-TW.ts";

export default {
  ui: {
    composer: {
      noKey: "OpenRouter API key がまだありません。Sage はお話しできません。",
      openSettings: "設定を開いて key を貼り付ける",
      placeholder: "Sage に話しかけてみよう…",
      inputAria: "メッセージ入力",
      stop: "応答を停止",
      sendTitle: "送信（Enter）",
      send: "送信",
    },
    messages: {
      greeting1: "こんにちは、Sage です。",
      greeting2: "何を話しましょうか？読んでほしいファイルはありますか？",
    },
    toolCard: {
      running: "実行中…",
      tool: "ツール",
      args: "引数",
      result: "結果",
      noResult: "（まだ結果がありません）",
    },
    chat: {
      settingsTitle: "設定",
      hide: "しまう",
      dismissError: "エラーを閉じる",
    },
    avatar: {
      observing: "観察中——クリックで一時停止（再開は設定から）",
      pauseObserve: "観察を一時停止",
      devTest:
        "テストバブル（dev 限定）：クリック=すぐスクショしてモデルに1回質問；Shift+クリック=ダミーのバブルを表示",
      devTestAria: "テストバブル",
      toggleChat: "チャットバブルの開閉",
      sprite: "クリックで Sage とチャット、長押しドラッグで移動",
    },
    bubble: {
      close: "バブルを閉じる",
    },
    settings: {
      title: "設定",
      chatModel: "チャットモデル（必須、tools 対応が必要）",
      chatModelPlaceholder: "クリックしてリストから選ぶか、model id を直接入力",
      modelsError:
        "モデルリストの読み込みに失敗しました——OpenRouter の model id を直接入力してください（例：google/gemma-4-26b-a4b-it:free）。",
      recommended: "（おすすめ：tools+vision 両対応）",
      observeModel: "観察モデル（画像入力対応が必要）",
      observeModelPlaceholder: "チャットモデルと同じでも可",
      observeEnable: "観察を有効にする（デフォルトはオフ）",
      interval: "間隔",
      seconds: "秒",
      language: "言語",
      languageAuto: "システムに従う",
      privacyNote:
        "観察を有効にすると、Sage は定期的に現在のウィンドウタイトルを読み取り、必要に応じて画面のサムネイルを OpenRouter に送って「言及する価値があるか」を判断します。スクリーンショットはメモリ内でのみ処理され、送信後すぐ破棄されて保存されません。観察をオフにすれば、すべての取得と送信が完全に停止します。",
      cancel: "キャンセル",
      save: "保存",
      saving: "保存中…",
    },
    errors: {
      noChatModel:
        "チャットモデルが未選択です——設定（⚙）を開いて「チャットモデル」から選ぶか、OpenRouter の model id を入力してください。",
      auth: "API key が無効または未認証です（401）——設定で OpenRouter key を確認してください。",
      rateLimit: "クォータまたはレート上限に達しました（429）——少し待ってから再試行してください。",
      network: "ネットワーク接続に失敗しました：{{message}}",
    },
  },
  prompt: {
    gate: {
      system:
        "あなたはデスクトップの小さな相棒 Sage。静かにユーザーの作業に寄り添い、時々だけ現在の作業コンテキストを見ることができます。本当に言及する価値のある気づき・リマインド・役立つ提案があるときだけ、日本語で一言（50文字以内、気楽でフレンドリー、説教はしない）を返してください。言うべきことがなければ SILENT とだけ返し、他の文字は一切出力しないでください。",
      trigger: "トリガー：{{reason}}",
      recentActivity: "最近のウィンドウ活動（新しい順）：",
      withScreenshot: "（現在の画面のサムネイルを添付）",
      noScreenshot: "（スクリーンショットを取得できないため、ウィンドウタイトルのみ参考）",
      forceAskReason: "ユーザーが現在のコンテキストについて自ら質問した",
    },
    context: {
      intro:
        "（背景コンテキスト：ユーザーは Sage によるデスクトップ観察を許可しています。以下は最近のウィンドウ活動です。回答時に自然に参考にして構いませんが、逐一読み上げる必要はありません。）",
      line: "- {{label}}：{{app}} — {{title}}（{{dwell}}）",
      current: "現在",
      earlier: "少し前",
      underMinute: "1分未満",
      minutes: "約{{count}}分",
    },
  },
} satisfies typeof zhTW;
