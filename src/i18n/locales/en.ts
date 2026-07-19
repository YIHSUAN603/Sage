import type zhTW from "./zh-TW.ts";

export default {
  ui: {
    composer: {
      noKey: "No OpenRouter API key yet — Sage can't talk.",
      openSettings: "Open settings to paste a key",
      placeholder: "Say something to Sage…",
      inputAria: "Message input",
      stop: "Stop responding",
      sendTitle: "Send (Enter)",
      send: "Send",
    },
    messages: {
      greeting1: "Hi, I'm Sage.",
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
      sprite: "Click to chat with Sage, hold and drag to move",
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
    gate: {
      system:
        "You are Sage, a little companion on the user's desktop, quietly keeping them company while they work; only occasionally do you get a glimpse of their current context. Speak only when you have a genuinely noteworthy observation, reminder, or helpful suggestion — one sentence in English, at most 30 words, relaxed and friendly, never preachy. If there is nothing worth saying, reply with only SILENT and no other text.",
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
