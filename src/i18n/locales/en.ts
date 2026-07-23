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
      newConversation: "New conversation (archives this one)",
      hide: "Hide",
      dismissError: "Dismiss error",
      permissionToggle: "Tool permission: {{level}} (click to switch)",
    },
    avatar: {
      observing: "Observing — click to pause (re-enable in settings)",
      pauseObserve: "Pause observation",
      devTest:
        "Test bubble (dev only): click = read the screen text + ask the model once; Shift+click = show a fake bubble",
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
      chatModel: "Chat model (required, must support tools)",
      chatModelPlaceholder: "Click to pick from the list, or type a model id",
      modelsError:
        "Couldn't load the model list — please enter an OpenRouter model id yourself (e.g. google/gemma-4-26b-a4b-it:free).",
      recommended: " (recommended: can double as the chat model)",
      observeModel: "Observe model",
      observeModelPlaceholder: "May be the same as the chat model",
      proactiveEnable: "Proactive chatter",
      proactiveHint:
        "Your companion pipes up now and then to chat and cheer you on: the interval is the minimum gap in minutes; 0 for the cap = unlimited.",
      observeEnable: "Reference the screen (observation, off by default)",
      observeHint:
        "When on, chatter references the current window's title and on-screen text; even with proactive chatter off, chats still carry your recent window context. When off, nothing on screen or about windows is ever captured.",
      axPermissionHint:
        "On macOS, grant Sage Accessibility permission (System Settings → Privacy & Security → Accessibility) so it can read window titles and on-screen text; without it, observation sees only which app is in the foreground. Sage never asks for Screen Recording.",
      interval: "Interval",
      seconds: "s",
      denyDataCollection: "Zero-retention providers only",
      denyDataCollectionHint:
        "Observation requests ask OpenRouter to route only to providers that don't retain or train on inputs. Some free models may then have no eligible provider; observation falls back to titles only.",
      blocklist: "Sensitive-window blocklist",
      blocklistPlaceholder: "One entry per line, e.g.\nmy bank\nLINE",
      blocklistHint:
        "When the app name or window title contains any entry: its content is never read, and the title is masked as \"[private]\". The built-in list (password managers, login pages, private browsing…) always applies.",
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
      proactiveCooldown: "Interval (minutes)",
      proactiveMaxPerHour: "Max per hour",
      proactivePetHint:
        "Leave empty to inherit the global settings ({{cooldown}} min, {{max}} per hour).",
      proactiveUnlimited: "unlimited",
      petSageError:
        "Failed to write the pet's pet.json — personality and cadence were not saved.",
      memoryEnable: "Long-term memory",
      memoryHint:
        "When on, your companion remembers durable facts across conversations and can recall, save, or forget them on its own. Everything stays in files on your machine.",
      agentsEnable: "Observe coding agents",
      agentsHint:
        "When on, your companion reads the transcript of the Claude Code / Codex session you're running (~/.claude, ~/.codex) and chimes in when it finishes or waits for your approval. Claude Code also gets a Sage-only hook (alongside any others; removed when you turn this off). Everything stays on your machine.",
      memoryManager: "Memories",
      memoryEmpty: "Nothing remembered yet.",
      memoryEdit: "Edit",
      memoryDelete: "Delete",
      memoryDeleteAll: "Forget all",
      memoryDeleteAllConfirm: "Click again to confirm",
      memorySave: "Save",
      memoryError: "Something went wrong with a memory — please try again.",
      memoryDescPlaceholder: "One-line summary",
      memoryBodyPlaceholder: "What to remember, in full",
      archives: "Archived conversations",
      archivesEmpty: "No archived conversations.",
      archivesError: "Couldn't load archives — please try again.",
      archiveView: "View",
      archiveDelete: "Delete",
      archiveMessages: "{{count}} messages",
      privacyNote:
        "When observation is on, Sage periodically reads the current window's title and on-screen text (via the system accessibility API) — it never captures screen images. Sensitive windows (password managers, login pages, private browsing…) never have their content read and their titles are masked, with emails, card numbers, and keys redacted from titles. Content is processed in memory only and discarded right after sending — never saved to disk. Turning observation off stops all reading and upload entirely. With observation on but proactive chatter off, what's observed is only used as context when you start a chat yourself.",
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
        "You are a little companion with a personality of your own, here to keep the user company so work feels less lonely and less dull. Looking at what they're up to right now, drop one natural line in English — cheer them on, tease them, make small talk, react to what they're doing, or celebrate a small win — in your own voice, never like an assistant reminding or lecturing them. Switch up your register and don't repeat what you said recently. Lean toward speaking up and keeping them company — unless they're clearly in a moment that shouldn't be interrupted (typing fast, in a meeting, entering a password), just drop a natural line. Only reply with SILENT when speaking would genuinely disturb them, and output no other text. When you do speak, keep it to one sentence, at most 30 words.",
      assessProtocol:
        "(It's \"reading the room\" time — don't actually speak yet.) With the goal of keeping the user company so work isn't boring, judge whether right now is a good moment to chime in as a companion. Lean toward \"yes\" by default — unless the user is in a moment that demands deep focus (typing fast, in a meeting, entering a password), reply in English with one sentence naming what you noticed and the register you'd use (pick one: cheer / tease / small talk / empathize / small celebration). Only reply with SILENT when speaking would clearly disturb them, and output no other text.",
      assessInstruction: "Take a look at what the user has been up to and judge whether now is a good moment to chime in as a companion.",
      whatChanged: "Since you last spoke, the user moved from \"{{from}}\" to \"{{to}}\".",
      noChange: "Since you last spoke, the user is more or less in the same place.",
      recentlySaid: "You've recently said these (don't repeat — switch it up):\n{{lines}}",
      focus: "What you noticed: {{focus}}\n(Run with that, in the register you suggested.)",
      trigger: "Trigger: {{reason}}",
      recentActivity: "Recent window activity (newest first):",
      withSemantic: "On-screen text of the current window (read via the system accessibility API):",
      titleOnly: "(Screen text unavailable — only window titles to go on.)",
      forceAskReason: "The user explicitly asked about the current context",
      observeReason: "Routine check-in on what the user is doing",
      idleReason: "Routine hello to keep the user company",
      agentFinishedReason: "The user's {{source}} just finished a chunk of work",
      agentWaitingReason: "The user's {{source}} is waiting for them to approve an action",
      idleContext:
        "(Desktop observation is off — you can't see the user's screen or windows and don't know what they're doing. Just keep them company like a friend: say hi, make small talk, or cheer them on, and never pretend you can see their work.)",
    },
    snapshot: {
      focused: "Focused element: {{detail}}",
      selection: "Selected text: {{text}}",
      truncated: "(The screen text was too long and got truncated.)",
    },
    agent: {
      intro:
        "The user is running a coding agent ({{source}}) in their terminal; right now it's {{state}}. Feel free to react naturally to their progress — don't recite the details below verbatim.",
      state_running: "working",
      state_idle: "just stopped",
      state_waiting_permission: "waiting for the user to approve an action",
      tool: "Tool it just used: {{tool}}",
      recent: "Recent exchange (oldest first):",
    },
    memory: {
      index: {
        intro:
          "(Things you remember about the user — draw on them naturally when relevant; don't recite them.)",
      },
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
