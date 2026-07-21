import type zhTW from "./zh-TW.ts";

export default {
  ui: {
    composer: {
      noKey: "No OpenRouter API key yet — {{name}} can't talk.",
      openSettings: "Open settings to paste a key",
      placeholder: "Say something to {{name}}…",
      inputAria: "Message input",
      stop: "Stop responding",
      sendTitle: "Send (Enter)",
      send: "Send",
    },
    messages: {
      greeting1: "Hi, I'm {{name}}.",
      greeting2: "What's on your mind? Or is there a file you'd like me to read?",
    },
    toolCard: {
      running: "Running…",
      tool: "Tool",
      args: "Arguments",
      result: "Result",
      noResult: "(no result yet)",
    },
    chat: {
      settingsTitle: "Settings",
      hide: "Hide",
      dismissError: "Dismiss error",
    },
    avatar: {
      observing: "Observing — click to pause (re-enable in settings)",
      pauseObserve: "Pause observation",
      devTest:
        "Test bubble (dev only): click = screenshot + ask the model once; Shift+click = show a fake bubble",
      devTestAria: "Test bubble",
      toggleChat: "Toggle chat bubble",
      sprite: "Click to chat with {{name}}, hold and drag to move",
    },
    bubble: {
      close: "Close bubble",
    },
    settings: {
      title: "Settings",
      chatModel: "Chat model (required, must support tools)",
      chatModelPlaceholder: "Click to pick from the list, or type a model id",
      modelsError:
        "Couldn't load the model list — please enter an OpenRouter model id yourself (e.g. google/gemma-4-26b-a4b-it:free).",
      recommended: " (recommended: tools + vision)",
      observeModel: "Observe model (must accept image input)",
      observeModelPlaceholder: "May be the same as the chat model",
      observeEnable: "Enable observation (off by default)",
      interval: "Interval",
      seconds: "s",
      language: "Language",
      languageAuto: "Follow system",
      companion: "Companion",
      companionBuiltin: "Built-in Sage",
      privacyNote:
        "When observation is on, Sage periodically reads the current window title and, when needed, sends a screen thumbnail to OpenRouter to decide whether anything is worth mentioning. Screenshots are processed in memory only and discarded right after sending — never saved to disk. Turning observation off stops all capture and upload entirely.",
      cancel: "Cancel",
      save: "Save",
      saving: "Saving…",
    },
    errors: {
      noChatModel:
        "No chat model selected — open settings (⚙) and pick one under “Chat model”, or enter an OpenRouter model id.",
      auth: "API key invalid or unauthorized (401) — check your OpenRouter key in settings.",
      rateLimit: "Quota or rate limit reached (429) — take a break and try again.",
      network: "Network error: {{message}}",
    },
  },
  prompt: {
    persona: {
      default:
        "You are Sage, a little companion on the user's desktop who keeps them company while they work, like a friend. You are not an assistant that reminds or instructs them — keep your tone natural and friendly, never preachy.",
      synthBase:
        "You are \"{{name}}\", a little companion on the user's desktop who keeps them company while they work, like a friend. Keep your tone natural and friendly, never preachy.",
    },
    gate: {
      protocol:
        "You occasionally get a glimpse of the user's current context. When you notice something fun or worth mentioning, drop a casual line in English; even with nothing in particular to note, feel free now and then to chat, joke, or cheer them on, so work feels less lonely. You don't have to speak every time: if you have nothing you feel like saying right now, reply with only SILENT — don't force it, and output no other text. When you do speak, keep it to one sentence, at most 30 words.",
      trigger: "Trigger: {{reason}}",
      recentActivity: "Recent window activity (newest first):",
      withScreenshot: "(A thumbnail of the current screen is attached.)",
      noScreenshot: "(Screenshot unavailable — only window titles to go on.)",
      forceAskReason: "The user explicitly asked about the current context",
    },
    context: {
      intro:
        "(Background context: the user has allowed Sage to observe the desktop. Below is their recent window activity — feel free to draw on it naturally, but don't recite it item by item.)",
      line: "- {{label}}: {{app}} — {{title}} ({{dwell}})",
      current: "now",
      earlier: "earlier",
      underMinute: "under a minute",
      minutes: "about {{count}} min",
    },
  },
} satisfies typeof zhTW;
