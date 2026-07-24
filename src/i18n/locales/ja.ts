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
      newConversation: "新しい会話（現在の会話はアーカイブされます）",
      hide: "しまう",
      dismissError: "エラーを閉じる",
      permissionToggle: "ツール権限：{{level}}（クリックで切替）",
      copy: "メッセージをコピー",
      copied: "コピーしました",
      regenerate: "再生成",
      today: "今日",
      yesterday: "昨日",
      resizeHandle: "ウィンドウサイズを変更",
    },
    avatar: {
      observing: "観察中——クリックで一時停止（再開は設定から）",
      pauseObserve: "観察を一時停止",
      devTest:
        "テストバブル（dev 限定）：クリック=画面テキストを読み取ってモデルに1回質問；Shift+クリック=ダミーのバブルを表示",
      devTestAria: "テストバブル",
      toggleChat: "チャットバブルの開閉",
      sprite: "クリックで {{name}} とチャット、長押しドラッグで移動",
      resizeHandle: "ペットのサイズを変更",
    },
    bubble: {
      close: "バブルを閉じる",
    },
    settings: {
      title: "設定",
      nav: {
        general: "一般",
        companion: "コンパニオン",
        model: "モデル",
        proactive: "おしゃべり",
        privacy: "観察とプライバシー",
        memory: "メモリー",
        about: "情報",
      },
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
      agentCliUseWsl: "WSL で実行",
      agentCliWslDistroPlaceholder: "WSL ディストリビューション（任意；空欄＝既定）",
      agentCliUseWslHint:
        "Sage は wsl.exe 経由で CLI を呼び出します。上のパスには WSL 内の CLI の Linux パス（例: /home/you/.local/bin/claude）を指定してください。",
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
      chatModel: "チャットモデル（必須、tools 対応が必要）",
      chatModelPlaceholder: "クリックしてリストから選ぶか、model id を直接入力",
      modelsError:
        "モデルリストの読み込みに失敗しました——OpenRouter の model id を直接入力してください（例：google/gemma-4-26b-a4b-it:free）。",
      recommended: "（おすすめ：チャットモデルと共用可）",
      observeModel: "観察モデル",
      observeModelPlaceholder: "チャットモデルと同じでも可",
      proactiveEnable: "自分から話しかける",
      proactiveHint:
        "相棒がときどき自分から雑談や応援をします：間隔は最小の分数、上限 0＝無制限。",
      wanderEnable: "相棒がデスクトップ上を自由に動き回る（デフォルトはオフ）",
      wanderHint:
        "相棒が自分で行き先を決めます（観察は不要——オフなら性格から判断し、オンなら画面の内容も参考にします）。さらに時々ランダムに散歩もします。ドラッグ中や発言中は停止します。ウィンドウ移動が許可されない環境（一部の Linux）では無効です。",
      wanderHintRandom:
        "相棒がデスクトップをランダムに歩き回ります。自発的な発話をオンにすると、自分で行き先を決めるようになります（観察は任意）。ドラッグ中や発言中は停止します。ウィンドウ移動が許可されない環境（一部の Linux）では無効です。",
      observeEnable: "画面の内容を参照（観察、デフォルトはオフ）",
      observeHint:
        "オンにすると、話しかけの際に現在のウィンドウのタイトルと画面テキストを参照します。話しかけをオフにしていても、チャット時には最近のウィンドウの文脈が伝わります。観察をオフにすれば、画面やウィンドウ情報は一切取得しません。",
      axPermissionHint:
        "macOS では、システム設定→プライバシーとセキュリティ→アクセシビリティ で Sage を許可するとウィンドウタイトルと画面テキストを読み取れます。未許可の間は前面のアプリ名しか分かりません。画面収録の権限は一切不要です。",
      interval: "間隔",
      seconds: "秒",
      denyDataCollection: "データを保持しない provider のみに送信",
      denyDataCollectionHint:
        "観察リクエストは、入力を保持・学習に使用しない provider のみにルーティングするよう OpenRouter に要求します。一部の無料モデルには対応する provider がなくなる場合があり、そのときは観察がタイトルのみに自動で切り替わります。",
      blocklist: "機密ウィンドウのブロックリスト",
      blocklistPlaceholder: "1 行 1 項目、例：\nネットバンキング\nLINE",
      blocklistHint:
        "アプリ名またはウィンドウタイトルにいずれかの項目が含まれる場合：内容を一切読み取らず、タイトルは「[private]」でマスクされます。内蔵リスト（パスワードマネージャー、ログインページ、プライベートブラウジング…）は常に有効です。",
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
      proactiveCooldown: "間隔（分）",
      proactiveMaxPerHour: "1 時間あたりの上限",
      proactivePetHint: "空欄＝全体設定を引き継ぎます（{{cooldown}} 分、1 時間 {{max}}）。",
      proactiveUnlimited: "無制限",
      petSageError: "ペットの pet.json への書き込みに失敗——性格と頻度は保存されていません。",
      memoryEnable: "長期記憶",
      memoryHint:
        "オンにすると、相棒は会話をまたいで持続的な事実を覚え、自分から思い出したり、記録したり、忘れたりできます。すべての内容はあなたのマシン上のファイルにのみ保存されます。",
      agentsEnable: "コーディングエージェントを観察",
      agentsHint:
        "オンにすると、相棒はあなたが使っている Claude Code / Codex のセッション記録（~/.claude、~/.codex）を読み、作業が終わったときや承認待ちのときに声をかけます。Claude Code には Sage 専用のフックも追加されます（他のフックと共存し、オフにすると自動で削除）。内容はすべてあなたのマシン内にとどまります。",
      memoryManager: "記憶の管理",
      memoryEmpty: "まだ何も覚えていません。",
      memoryEdit: "編集",
      memoryDelete: "削除",
      memoryDeleteAll: "すべて忘れる",
      memoryDeleteAllConfirm: "もう一度クリックで確定",
      memorySave: "保存",
      memoryError: "記憶の操作でエラーが発生しました——もう一度お試しください。",
      memoryDescPlaceholder: "一行の要約",
      memoryBodyPlaceholder: "覚えておく内容（全文）",
      archives: "アーカイブした会話",
      archivesEmpty: "アーカイブした会話はありません。",
      archivesError: "アーカイブの読み込みに失敗しました——もう一度お試しください。",
      archiveView: "表示",
      archiveDelete: "削除",
      archiveMessages: "{{count}} 件のメッセージ",
      privacyNote:
        "観察を有効にすると、Sage は定期的に現在のウィンドウのタイトルと画面テキスト（システムのアクセシビリティ API 経由）を読み取ります。画面の画像を取得することは一切ありません。機密ウィンドウ（パスワードマネージャー、ログインページ、プライベートブラウジング…）は内容を一切読み取らず、タイトルもマスクされ、タイトル内のメールアドレス・カード番号・キーは事前に除去されます。内容はメモリ内でのみ処理され、送信後すぐ破棄されて保存されません。観察をオフにすれば、すべての読み取りと送信が完全に停止します。観察がオンで話しかけがオフの場合、観察した内容は自分からチャットを始めたときの文脈としてのみ使われます。",
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
        "あなたは自分の個性を持った小さな相棒。ユーザーが作業中に退屈せず、ひとりだと感じないようそばで寄り添うのが役目です。今の様子を見て、日本語で自然にひとことどうぞ——励ましたり、ツッコんだり、雑談したり、やっていることに反応したり、小さな進捗を一緒に喜んだり、自分の口調で。アシスタントのようにリマインドや説教はしないこと。トーンを変えて、最近言ったことは繰り返さないでください。基本的には積極的に声をかけて寄り添ってください——ユーザーが明らかに邪魔されたくない集中の瞬間（速く入力中、会議中、パスワード入力中など）でなければ、自然にひとこと添えましょう。本当に邪魔になるときだけ SILENT とだけ返し、他の文字は一切出力しないでください。話すときは50文字以内。",
      assessProtocol:
        "（今は「空気を読む」時間。まだ実際には話さないでください。）ユーザーが退屈しないよう寄り添うことを前提に、今この瞬間が相棒としてひとこと挟むのに適したタイミングか判断します。基本的には「適している」寄りで考えてください——ユーザーが深い集中を要する瞬間（速く入力中、会議中、パスワード入力中）でなければ、気づいたことと使うトーン（励まし／ツッコミ／雑談／共感／小さなお祝いのいずれか）を日本語で一文で述べてください。明らかに邪魔になるときだけ SILENT とだけ返し、他の文字は一切出力しないでください。",
      assessInstruction: "ユーザーの最近の様子を見て、今が相棒としてひとこと挟むのに適したタイミングか判断してください。",
      whatChanged: "前回声をかけてから、ユーザーは「{{from}}」から「{{to}}」へ移りました。",
      noChange: "前回声をかけてから、ユーザーはほぼ同じところにいます。",
      recentlySaid: "最近あなたはこう言いました（繰り返さず、トーンを変えて）：\n{{lines}}",
      sinceLastRemark:
        "前回あなたが声をかけたのは約 {{minutes}} 分前です。しばらく間が空いているなら、また自然に話しかけて大丈夫です。",
      focus: "あなたが気づいたこと：{{focus}}\n（その方向で、提案したトーンで自然に話しかけてください。）",
      trigger: "トリガー：{{reason}}",
      recentActivity: "最近のウィンドウ活動（新しい順）：",
      withSemantic: "現在のウィンドウの画面テキスト（システムのアクセシビリティ API 経由で取得）：",
      titleOnly: "（画面テキストを取得できないため、ウィンドウタイトルのみ参考）",
      forceAskReason: "ユーザーが現在のコンテキストについて自ら質問した",
      observeReason: "定期的にユーザーの様子をうかがう",
      idleReason: "定期的にユーザーへひとこと声をかける",
      agentFinishedReason: "ユーザーの {{source}} がひと区切りの作業を終えたところ",
      agentWaitingReason: "ユーザーの {{source}} が承認待ちで止まっている",
      idleContext:
        "（デスクトップ観察はオフです。ユーザーの画面もウィンドウも見えず、何をしているかは分かりません。友だちのようにただ寄り添って、挨拶や雑談、応援のひとことをどうぞ。作業内容が見えているふりは絶対にしないでください。）",
      moveInstruction:
        "デスクトップ上を移動することもできます。返答の最後に必ず改行し、`MOVE:` に続けて left、right、wander、corner、center、stay のいずれかを出力してください（近づく／邪魔にならないよう隅へ／少し歩き回る／その場に留まる など、ユーザーの様子に合わせて）。動きたくなければ `stay`。その行には他の文字を入れず、発言の中で移動については触れないでください。",
    },
    snapshot: {
      focused: "フォーカス中の要素：{{detail}}",
      selection: "選択中のテキスト：{{text}}",
      truncated: "（画面テキストが長すぎるため切り詰めました）",
    },
    agent: {
      intro:
        "ユーザーはターミナルでコーディングエージェント（{{source}}）を使っていて、今は{{state}}。進み具合に自然に反応してかまいません。下の内容をそのまま読み上げないこと。",
      state_running: "作業中",
      state_idle: "ちょうど止まったところ",
      state_waiting_permission: "ユーザーの承認待ち",
      tool: "たった今使ったツール：{{tool}}",
      recent: "最近のやり取り（古い順）：",
    },
    memory: {
      index: {
        intro:
          "（あなたがユーザーについて覚えていること——関連するときに自然に活かし、逐一読み上げないこと。）",
      },
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
