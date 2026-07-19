# Sage

**A floating AI desktop companion** — a tiny, always-on-top character that lives on your desktop, chats with you, and (only if you let it) keeps an eye on what you're working on so it can chime in when it has something useful to say.

Built with Tauri 2, React 19, and TypeScript. Powered by free models on [OpenRouter](https://openrouter.ai/).

## Features

- **Floating avatar** — a small, transparent, draggable, always-on-top character window. No dock icon, no taskbar entry. Click it to open the chat.
- **Streaming chat** — token-by-token streaming responses with an abortable composer (Enter to send, Shift+Enter for a new line).
- **Tool calling** — the assistant can call tools (currently `read_file`) through a data-driven registry; tool calls and results render as collapsible cards in the chat. Adding a tool doesn't touch the agent loop.
- **Context observation (opt-in)** — Sage can sample your active window title (cheap, frequent) and take throttled, downscaled screenshots (expensive, on demand) to understand what you're doing.
- **Proactive bubbles** — when observation detects something worth mentioning (stuck on the same window, rapid app switching, returning from idle…), Sage pops a small speech bubble instead of interrupting you with a full window. Rate-limited and cooled down so it stays quiet most of the time.
- **Free models, chosen by capability** — model lists are fetched live from OpenRouter and filtered dynamically: fully free pricing, `tools` support for the chat model, `image` input for the observation model. Nothing is hard-coded.
- **Multilingual UI** — English, 繁體中文, 简体中文, 日本語 (via i18next).

## How it works

The architecture follows one rule: **Rust provides capabilities, the frontend orchestrates.**

- The Rust side (`src-tauri/src/`) exposes narrow commands: LLM streaming over SSE (`llm.rs`), screen capture (`capture.rs`), active-window lookup (`context.rs`), local settings (`settings.rs`), and file reading (`tools.rs`). The OpenRouter API key is read from settings inside Rust and never enters JavaScript.
- The frontend owns all state and logic: the function-calling agent loop (`src/llm/loop.ts`), SSE delta accumulation (`src/llm/openrouter.ts`), the tool registry (`src/tools/`), the observation pipeline (`src/observe/`), and Zustand stores (`src/store/`).
- Three Tauri windows share one React bundle, selected by a `?window=` query param: `avatar` (the character), `bubble` (proactive toasts), and `chat` (the conversation panel).

## Privacy

Observation is a hard opt-in, not a default:

- Observation is **off by default** and must be explicitly enabled in Settings; it can be paused at any time.
- Screenshots are processed **in memory only** — downscaled, sent to the vision model, then discarded. Nothing is written to disk.
- With observation off, no capture or upload of any kind happens.
- Screen capture on macOS requires the Screen Recording permission (TCC); if denied, Sage falls back to window-title-only mode.
- Your API key is stored in the local app config directory and stays out of version control and out of the webview.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 22+ (tests use the built-in type-stripping test runner)
- [Rust](https://rustup.rs/) (stable) and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform
- An [OpenRouter API key](https://openrouter.ai/keys) (free models work — no credit required)

### Run

```sh
npm install
npm run tauri dev
```

Then click the avatar, open Settings, paste your OpenRouter API key, and pick a chat model (and optionally a vision model for observation).

### Scripts

| Command | What it does |
| --- | --- |
| `npm run tauri dev` | Run the desktop app in development |
| `npm run tauri build` | Build the production app bundle |
| `npm test` | Run unit tests (`node --test` with type stripping) |
| `npm run build` | Type-check and build the frontend only |

## Project structure

```
src/
  ipc/        IPC contract, real Tauri bindings, and mocks for tests
  llm/        OpenRouter types, SSE accumulation, model filtering, agent loop
  tools/      Data-driven tool registry (add a tool without touching the loop)
  observe/    Sampler, "worth mentioning" heuristics, gate, runner
  store/      Zustand stores (chat, settings, observation)
  windows/    Avatar / Bubble / Chat window components
  components/ Composer, message list, tool-call cards, settings dialog
  i18n/       Locales: en, zh-TW, zh-CN, ja
src-tauri/
  src/        Rust capabilities: llm, capture, context, settings, tools
```

## Notes

- **macOS private API** — `macOSPrivateApi` is enabled in `tauri.conf.json` to support the transparent, borderless windows.
- **exFAT volumes** — if the repo lives on an exFAT drive, macOS creates AppleDouble (`._*`) files that break the Tauri build. The `predev`/`prebuild` hooks clean them automatically (`npm run clean:appledouble`).

## License

[MIT](LICENSE)
