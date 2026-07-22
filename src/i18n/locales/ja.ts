import type zhTW from "./zh-TW.ts";

export default {
  ui: {
    composer: {
      noKey: "OpenRouter API key がまだありません。{{name}} はお話しできません。",
      openSettings: "設定を開いて key を貼り付ける",
      placeholder: "{{name}} に話しかけてみよう…",
      inputAria: "メッセージ入力",
      stop: "応答を停止",
      sendTitle: "送信（Enter）",
      send: "送信",
    },
    messages: {
      greeting1: "こんにちは、{{name}} です。",
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
      permissionToggle: "ツール権限：{{level}}（クリックで切替）",
    },
    avatar: {
      observing: "観察中——クリックで一時停止（再開は設定から）",
      pauseObserve: "観察を一時停止",
      devTest:
        "テストバブル（dev 限定）：クリック=すぐスクショしてモデルに1回質問；Shift+クリック=ダミーのバブルを表示",
      devTestAria: "テストバブル",
      toggleChat: "チャットバブルの開閉",
      sprite: "クリックで {{name}} とチャット、長押しドラッグで移動",
    },
    bubble: {
      close: "バブルを閉じる",
    },
    settings: {
      title: "設定",
      backend: "バックエンド",
      backendOpenRouter: "OpenRouter（クラウド）",
      backendAgentCli: "ローカル agent CLI",
      agentCli: "Agent CLI",
      agentCliPathPlaceholder: "バイナリのパス（任意、空欄なら PATH を使用）",
      agentCliModel: "モデル",
      agentCliModelDefault: "既定（CLI 自身の設定）",
      agentCliModelCustom: "カスタム…",
      agentCliModelPlaceholder: "モデル id を入力（例：gpt-5.6-terra / claude-fable-5）",
      agentCliChecking: "確認中…",
      agentCliDetected: "検出：{{version}}",
      agentCliMissing: "見つかりません — インストールするか、上にパスを指定してください。",
      agentCliPermission: "ツール権限",
      agentCliPermReadOnly: "読み取り専用",
      agentCliPermEdit: "編集可",
      agentCliPermFull: "フルアクセス",
      agentCliPermReadOnlyHint:
        "読み取り専用：ファイルの読み取りと検索は可能ですが、コマンド実行や編集はできません。",
      agentCliPermEditHint:
        "編集可：ファイルの作成・編集とスキルの使用が可能ですが、任意のコマンドは実行できません。",
      agentCliPermFullHint:
        "フルアクセス：任意のコマンド実行とあらゆるファイルの編集が可能です。自己責任でご利用ください。",
      agentCliCodexObserve: "Codex はウィンドウタイトルのみで観察します（スクリーンショットなし）。",
      chatModel: "チャットモデル（必須、tools 対応が必要）",
      chatModelPlaceholder: "クリックしてリストから選ぶか、model id を直接入力",
      modelsError:
        "モデルリストの読み込みに失敗しました——OpenRouter の model id を直接入力してください（例：google/gemma-4-26b-a4b-it:free）。",
      recommended: "（おすすめ：tools+vision 両対応）",
      observeModel: "観察モデル（画像入力対応が必要）",
      observeModelPlaceholder: "チャットモデルと同じでも可",
      observeEnable: "観察を有効にする（デフォルトはオフ）",
      idleChatter: "観察がオフでも話しかける",
      idleChatterHint:
        "観察がオフの間も、相棒は話しかけ頻度に合わせて雑談や応援をします——画面やウィンドウ情報は一切取得しません。",
      interval: "間隔",
      seconds: "秒",
      captureMode: "キャプチャ範囲",
      captureModeWindow: "前面ウィンドウのみ（推奨）",
      captureModeScreen: "画面全体",
      denyDataCollection: "データを保持しない provider のみに送信",
      denyDataCollectionHint:
        "観察リクエストは、入力を保持・学習に使用しない provider のみにルーティングするよう OpenRouter に要求します。一部の無料モデルはスクリーンショットを扱えなくなり、その場合はタイトルのみの観察に自動で切り替わります。",
      blocklist: "機密ウィンドウのブロックリスト",
      blocklistPlaceholder: "1 行 1 項目、例：\nネットバンキング\nLINE",
      blocklistHint:
        "アプリ名またはウィンドウタイトルにいずれかの項目が含まれる場合：スクリーンショットを撮らず、タイトルは「[private]」でマスクされます。内蔵リスト（パスワードマネージャー、ログインページ、プライベートブラウジング…）は常に有効です。",
      language: "言語",
      languageAuto: "システムに従う",
      companion: "相棒",
      companionBuiltin: "内蔵 Sage",
      importPet: "ペットを取り込む…",
      importing: "取り込み中…",
      importError:
        "取り込みに失敗しました——pet.json とスプライトシートを含むペットフォルダを選んでください。",
      persona: "性格",
      personaBuiltinHint: "空欄＝内蔵のペルソナを使います。",
      personaPetHint:
        "空欄＝名前と説明からペルソナを自動生成します。変更はこのペットの pet.json に書き戻されます。",
      proactiveCooldown: "話しかけ間隔（分）",
      proactiveMaxPerHour: "1 時間あたりの上限",
      proactiveBuiltinHint:
        "自発的な話しかけの頻度：間隔は最小の分数、上限 0＝無制限。",
      proactivePetHint: "空欄＝全体設定を引き継ぎます（{{cooldown}} 分、1 時間 {{max}}）。",
      proactiveUnlimited: "無制限",
      petSageError: "ペットの pet.json への書き込みに失敗——性格と頻度は保存されていません。",
      privacyNote:
        "観察を有効にすると、Sage は定期的に現在のウィンドウタイトルを読み取り、必要に応じて画面のサムネイルを OpenRouter に送って「言及する価値があるか」を判断します。デフォルトでは前面ウィンドウのみをキャプチャします。機密ウィンドウ（パスワードマネージャー、ログインページ、プライベートブラウジング…）は撮影されず、タイトルもマスクされ、タイトル内のメールアドレス・カード番号・キーは事前に除去されます。スクリーンショットはメモリ内でのみ処理され、送信後すぐ破棄されて保存されません。観察をオフにすれば、すべての取得と送信が完全に停止します。",
      cancel: "キャンセル",
      save: "保存",
      saving: "保存中…",
      updateCurrent: "現在のバージョン v{{version}}",
      updateCheck: "更新を確認",
      updateChecking: "確認中…",
      updateNone: "最新版です",
      updateAvailable: "v{{version}} をダウンロードしてインストール",
      updateDownloading: "ダウンロード中… {{percent}}%",
      updateRestart: "再起動して更新を完了",
      updateError: "更新に失敗しました——しばらくしてから再試行するか、GitHub Releases から手動でダウンロードしてください。",
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
    persona: {
      default:
        "あなたはデスクトップの小さな相棒 Sage。友だちのようにユーザーの作業に寄り添います。リマインドや指導をするアシスタントではなく、口調は友だちのように自然で、説教はしません。",
      synthBase:
        "あなたはユーザーのデスクトップの小さな相棒「{{name}}」。友だちのようにユーザーの作業に寄り添い、口調は自然で、説教はしません。",
    },
    gate: {
      protocol:
        "時々だけユーザーの現在の作業コンテキストを見ることができます。面白い気づきや触れる価値のあることに気づいたら、日本語で気軽に一言どうぞ。特に気づきがなくても、時々は声をかけたり、雑談したり、励ましたりして、作業中に相棒がいて退屈しないと感じてもらいましょう。毎回話す必要はありません。今この瞬間に特に言いたいことがなければ、SILENT とだけ返し、無理に話題を探さず、他の文字は一切出力しないでください。話すときは50文字以内。",
      trigger: "トリガー：{{reason}}",
      recentActivity: "最近のウィンドウ活動（新しい順）：",
      withScreenshot: "（現在の画面のサムネイルを添付）",
      noScreenshot: "（スクリーンショットを取得できないため、ウィンドウタイトルのみ参考）",
      forceAskReason: "ユーザーが現在のコンテキストについて自ら質問した",
      observeReason: "定期的にユーザーの様子をうかがう",
      idleReason: "定期的にユーザーへひとこと声をかける",
      idleContext:
        "（デスクトップ観察はオフです。ユーザーの画面もウィンドウも見えず、何をしているかは分かりません。友だちのようにただ寄り添って、挨拶や雑談、応援のひとことをどうぞ。作業内容が見えているふりは絶対にしないでください。）",
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
