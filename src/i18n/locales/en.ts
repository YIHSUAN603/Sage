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
      permissionToggle: "Tool permission: {{level}} (click to switch)",
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
      backend: "Backend",
      backendOpenRouter: "OpenRouter (cloud)",
      backendAgentCli: "Local agent CLI",
      agentCli: "Agent CLI",
      agentCliPathPlaceholder: "Binary path (optional; leave blank to use PATH)",
      agentCliModel: "Model",
      agentCliModelDefault: "Default (the CLI's own setting)",
      agentCliModelCustom: "Custom…",
      agentCliModelPlaceholder: "Enter a model id (e.g. gpt-5.6-terra or claude-fable-5)",
      agentCliChecking: "Checking…",
      agentCliDetected: "Detected: {{version}}",
      agentCliMissing: "Not found — install it or set the path above.",
      agentCliPermission: "Tool permission",
      agentCliPermReadOnly: "Read-only",
      agentCliPermEdit: "Can edit",
      agentCliPermFull: "Full access",
      agentCliPermReadOnlyHint:
        "Read-only: it can read files and search, but not run commands or edit.",
      agentCliPermEditHint:
        "Can edit: it can create and modify files and use skills, but still can't run arbitrary commands.",
      agentCliPermFullHint:
        "Full access: it can run arbitrary commands and modify any file — use at your own risk.",
      agentCliCodexObserve: "Codex observes by window title only (no screenshot).",
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
      captureMode: "Capture area",
      captureModeWindow: "Focused window only (recommended)",
      captureModeScreen: "Entire screen",
      denyDataCollection: "Zero-retention providers only",
      denyDataCollectionHint:
        "Observation requests ask OpenRouter to route only to providers that don't retain or train on inputs. Some free models may then be unable to take screenshots; observation falls back to titles only.",
      blocklist: "Sensitive-window blocklist",
      blocklistPlaceholder: "One entry per line, e.g.\nmy bank\nLINE",
      blocklistHint:
        "When the app name or window title contains any entry: no screenshot, and the title is masked as \"[private]\". The built-in list (password managers, login pages, private browsing…) always applies.",
      language: "Language",
      languageAuto: "Follow system",
      companion: "Companion",
      companionBuiltin: "Built-in Sage",
      importPet: "Import pet…",
      importing: "Importing…",
      importError:
        "Import failed — pick a pet folder containing a pet.json and its spritesheet.",
      persona: "Personality",
      personaBuiltinHint: "Leave empty to use the built-in persona.",
      personaPetHint:
        "Leave empty to synthesize one from the pet's name and description. Changes are written back to this pet's pet.json.",
      proactiveCooldown: "Chatter interval (minutes)",
      proactiveMaxPerHour: "Max per hour",
      proactiveBuiltinHint:
        "Proactive chatter cadence: the interval is the minimum gap in minutes; 0 for the cap = unlimited.",
      proactivePetHint:
        "Leave empty to inherit the global settings ({{cooldown}} min, {{max}} per hour).",
      proactiveUnlimited: "unlimited",
      petSageError:
        "Failed to write the pet's pet.json — personality and cadence were not saved.",
      privacyNote:
        "When observation is on, Sage periodically reads the current window title and, when needed, sends a screen thumbnail to OpenRouter to decide whether anything is worth mentioning. By default only the focused window is captured; sensitive windows (password managers, login pages, private browsing…) are never photographed and their titles are masked, and emails, card numbers, and keys are redacted from titles. Screenshots are processed in memory only and discarded right after sending — never saved to disk. Turning observation off stops all capture and upload entirely.",
      cancel: "Cancel",
      save: "Save",
      saving: "Saving…",
      updateCurrent: "Current version v{{version}}",
      updateCheck: "Check for updates",
      updateChecking: "Checking…",
      updateNone: "Up to date",
      updateAvailable: "Download & install v{{version}}",
      updateDownloading: "Downloading… {{percent}}%",
      updateRestart: "Restart to finish update",
      updateError: "Update failed — try again later or download manually from GitHub Releases.",
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
      observeReason: "Routine check-in on what the user is doing",
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
