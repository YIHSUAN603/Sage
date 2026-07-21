import type zhTW from "./zh-TW.ts";

export default {
  ui: {
    composer: {
      noKey: "还没有 OpenRouter API key，{{name}} 说不了话。",
      openSettings: "打开设置粘贴 key",
      placeholder: "跟 {{name}} 说点什么…",
      inputAria: "消息输入",
      stop: "停止回复",
      sendTitle: "发送（Enter）",
      send: "发送",
    },
    messages: {
      greeting1: "嗨，我是 {{name}}。",
      greeting2: "想聊什么，或者有想让我读的文件吗？",
    },
    toolCard: {
      running: "执行中…",
      tool: "工具",
      args: "参数",
      result: "返回",
      noResult: "（还没有结果）",
    },
    chat: {
      settingsTitle: "设置",
      hide: "收起",
      dismissError: "关闭错误信息",
    },
    avatar: {
      observing: "观察中——点一下暂停（重新开启请到设置）",
      pauseObserve: "暂停观察",
      devTest: "测试冒泡（dev 限定）：点=立刻截图问模型一次；Shift+点=直接出假气泡",
      devTestAria: "测试冒泡",
      toggleChat: "开关对话气泡",
      sprite: "点一下跟 {{name}} 聊天，按住拖拽移动",
    },
    bubble: {
      close: "关闭冒泡",
    },
    settings: {
      title: "设置",
      chatModel: "聊天模型（必填，需支持 tools）",
      chatModelPlaceholder: "点一下从列表挑选，或直接填 model id",
      modelsError:
        "模型列表加载失败——请自行填入 OpenRouter model id（例：google/gemma-4-26b-a4b-it:free）。",
      recommended: "（推荐：tools+vision 通吃）",
      observeModel: "观察模型（需支持图片输入）",
      observeModelPlaceholder: "可与聊天模型相同",
      observeEnable: "开启观察（默认关闭）",
      interval: "间隔",
      seconds: "秒",
      language: "语言",
      languageAuto: "跟随系统",
      companion: "伙伴",
      companionBuiltin: "内建 Sage",
      importPet: "导入宠物…",
      importing: "导入中…",
      importError: "导入失败——请选一个含 pet.json 与 spritesheet 的宠物文件夹。",
      privacyNote:
        "观察开启后，Sage 会定期读取当前窗口标题，必要时截取屏幕缩略图发送给 OpenRouter 判断“有没有值得一提的事”。截图只在内存中处理、发送后即丢弃，不会存盘；关闭观察即完全停止一切截取与上传。",
      cancel: "取消",
      save: "保存",
      saving: "保存中…",
    },
    errors: {
      noChatModel:
        "尚未选择聊天模型——请打开设置（⚙），在“聊天模型”挑一个或填入 OpenRouter model id。",
      auth: "API key 无效或未授权（401）——请到设置检查 OpenRouter key。",
      rateLimit: "额度或速率已达上限（429）——休息一下再试。",
      network: "网络连接失败：{{message}}",
    },
  },
  prompt: {
    persona: {
      default:
        "你是桌面上的小伙伴 Sage，像朋友一样陪着用户工作。你不是提醒或指导他的助理，语气像朋友一样自然、不说教。",
      synthBase:
        "你是用户桌面上的小伙伴「{{name}}」，像朋友一样陪着用户工作，语气自然、不说教。",
    },
    gate: {
      protocol:
        "你偶尔会看到用户当前的工作脉络。看到有趣或值得一提的观察时，就用简体中文随口聊一句；就算没什么特别的观察，偶尔也可以搭句话、闲聊或打打气，让他工作时有人陪、不无聊。但不用每次都讲话，如果这个当下你没什么想说的，就只回复 SILENT，别硬找话说，也不要输出任何其他文字。开口时控制在 50 字以内。",
      trigger: "触发原因：{{reason}}",
      recentActivity: "最近的窗口活动（新到旧）：",
      withScreenshot: "（附上当前的屏幕缩略图）",
      noScreenshot: "（无法获取屏幕截图，只有窗口标题可参考）",
      forceAskReason: "用户主动询问当前脉络",
    },
    context: {
      intro:
        "（背景脉络：用户已授权 Sage 观察桌面。以下是最近的窗口活动，回答时可自然地参考，但不必主动逐条复述。）",
      line: "- {{label}}：{{app}} — {{title}}（{{dwell}}）",
      current: "当前",
      earlier: "稍早",
      underMinute: "不到 1 分钟",
      minutes: "约 {{count}} 分钟",
    },
  },
} satisfies typeof zhTW;
