# Sage

**A floating AI desktop companion** — a tiny, always-on-top character that lives on your desktop, chats with you, and (only if you let it) keeps an eye on what you're working on so it can chime in when it has something useful to say.

Built with Tauri 2, React 19, and TypeScript. Powered by free models on [OpenRouter](https://openrouter.ai/).

## Features

- **Floating avatar** — a small, transparent, draggable, always-on-top character window. No dock icon, no taskbar entry. Click it to open the chat.
- **Streaming chat** — token-by-token streaming responses with an abortable composer (Enter to send, Shift+Enter for a new line).
- **Tool calling** — the assistant can call tools (currently `read_file`) through a data-driven registry; tool calls and results render as collapsible cards in the chat. Adding a tool doesn't touch the agent loop.
- **Skills** — drop Claude-Code-compatible skill folders (a `SKILL.md` with `name`/`description` frontmatter) into `<app config dir>/skills/`, and the assistant loads their full instructions on demand via a `use_skill` tool whenever a task matches. New skills take effect on the next message — no restart.
- **Companions (opt-in character)** — swap the built-in Sage for a custom pet. Drop a folder following the Codex *pet* contract (what OpenAI's `hatch-pet` skill produces) into `<app config dir>/pets/`, and its animated spritesheet becomes the avatar. An optional `sage` block in `pet.json` gives it a custom persona and proactive tuning; a plain hatch-pet folder with neither still works — Sage synthesizes a persona from the name and description. Pick one in Settings; empty falls back to built-in Sage.
- **Context observation (opt-in)** — Sage can sample your active window title (cheap, frequent) and take throttled, downscaled screenshots (expensive, on demand) to understand what you're doing.
- **Proactive bubbles** — when observation detects something worth mentioning (stuck on the same window, rapid app switching, returning from idle…), Sage pops a small speech bubble instead of interrupting you with a full window. Rate-limited and cooled down so it stays quiet most of the time.
- **Free models, chosen by capability** — model lists are fetched live from OpenRouter and filtered dynamically: fully free pricing, `tools` support for the chat model, `image` input for the observation model. Nothing is hard-coded.
- **Multilingual UI** — English, 繁體中文, 简体中文, 日本語 (via i18next).

## How it works

The architecture follows one rule: **Rust provides capabilities, the frontend orchestrates.**

- The Rust side (`src-tauri/src/`) exposes narrow commands: LLM streaming over SSE (`llm.rs`), screen capture (`capture.rs`), active-window lookup (`context.rs`), local settings (`settings.rs`), file reading (`tools.rs`), and pet/companion discovery (`pets.rs`). The OpenRouter API key is read from settings inside Rust and never enters JavaScript.
- The frontend owns all state and logic: the function-calling agent loop (`src/llm/loop.ts`), SSE delta accumulation (`src/llm/openrouter.ts`), the tool registry (`src/tools/`), the observation pipeline (`src/observe/`), and Zustand stores (`src/store/`).
- Skills are plain folders under `<app config dir>/skills/` (created on first scan; next to `settings.json`). Each folder holds a `SKILL.md`; the frontmatter's `name` and `description` go into the `use_skill` tool's catalog, and the body is returned when the model invokes the skill:

  ```markdown
  ---
  name: pirate-talk
  description: Use when the user wants pirate-styled replies.
  ---

  Always answer like a pirate. End sentences with "arr".
  ```
- Companions are folders under `<app config dir>/pets/` (created on first scan, next to `skills/`). Each holds a `pet.json` following the Codex *pet* contract — `id`, `displayName`, `description`, `spritesheetPath` — plus the spritesheet image it names. Sage adds one optional, additive key, `sage`, for a custom persona and proactive tuning; Codex ignores unknown keys, so a plain hatch-pet folder loads unchanged:

  ```json
  {
    "id": "hatchling",
    "displayName": "小龍",
    "description": "A freshly hatched dragon.",
    "spritesheetPath": "spritesheet.webp",
    "sage": { "persona": "You are a tiny dragon…", "proactive": { "cooldownMinutes": 5, "maxPerHour": 6 } }
  }
  ```

  When a companion is selected, its `persona` drives both the chat and the proactive gate (injected as a request-only system message, so chat history stays clean), and its spritesheet is animated in the avatar window. With no `sage.persona`, Sage synthesizes one from the pet's name and description.
- Three Tauri windows share one React bundle, selected by a `?window=` query param: `avatar` (the character), `bubble` (proactive toasts), and `chat` (the conversation panel).

## Privacy

Observation is a hard opt-in, not a default:

- Observation is **off by default** and must be explicitly enabled in Settings; it can be paused at any time.
- By default only the **focused window** is captured — background windows (messages, banking tabs…) never enter the frame. Full-screen capture is an explicit opt-in.
- A **sensitive-window blocklist** (password managers, login pages, private-browsing windows, plus your own entries) is enforced in Rust: blocklisted windows are never screenshotted and their titles are masked before anything leaves the machine.
- Window titles are **sanitized** before use — emails, long digit runs (card/phone numbers), and API-key-shaped tokens are redacted.
- Observation requests ask OpenRouter to route only to **zero-retention providers** (`data_collection: "deny"`, on by default). Note that free models' data policies are otherwise up to each provider; with deny on, a model without an eligible provider falls back to title-only observation.
- Screenshots are processed **in memory only** — downscaled, sent to the vision model, then discarded. Nothing is written to disk.
- With observation off, no capture or upload of any kind happens.
- Screen capture on macOS requires the Screen Recording permission (TCC); if denied, Sage falls back to window-title-only mode.
- Your API key is stored in the local app config directory and stays out of version control and out of the webview.

## Install

### macOS (Homebrew, recommended)

1. **Install [Homebrew](https://brew.sh/)** if you don't have it yet:

   ```sh
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

   Check with `brew --version` if you're not sure whether it's already installed.

2. **Install Sage:**

   ```sh
   brew install --cask YIHSUAN603/tap/sage
   ```

   - Use the full name `YIHSUAN603/tap/sage` — the official Homebrew repo has an unrelated `sage` cask (SageMath).
   - macOS builds are unsigned, so the cask clears the quarantine flag for you after install (Homebrew 6 removed the old `--no-quarantine` flag). If you still see an "app is damaged" dialog, run `xattr -cr /Applications/sage.app` once.

3. **Launch it** — the app is installed to `/Applications/sage.app`; open it from Launchpad/Spotlight, or:

   ```sh
   open /Applications/sage.app
   ```

To upgrade later: `brew upgrade --cask sage` (or use the in-app updater).
To uninstall: `brew uninstall --cask sage`.

### Manual download

Grab the installer for your platform from the [Releases page](../../releases). If you install the macOS `.dmg` directly, clear the quarantine flag before first launch:

```sh
xattr -cr /Applications/sage.app
```

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

## CI / Releases

GitHub Actions runs on every push and PR (`.github/workflows/ci.yml`): frontend type-check, build, and tests, plus `cargo test` for the Rust side.

To publish a release (`.github/workflows/release.yml`):

1. Bump the version in `src-tauri/tauri.conf.json`, `package.json`, and `src-tauri/Cargo.toml`, then commit.
2. Tag and push: `git tag v0.2.0 && git push --tags`.
3. Actions builds installers for macOS (Apple Silicon + Intel), Windows, and Linux, and creates a **draft** GitHub Release.
4. Review the draft on the Releases page and publish it.

### In-app updates

Installed apps update themselves via `tauri-plugin-updater`: Settings → "Check for updates" fetches `latest.json` from the latest **published** GitHub Release, so publishing the draft (step 4) is what actually ships the update to users.

Update packages are signed with a minisign key (public key in `tauri.conf.json`; private key stays out of the repo). CI signs them via the `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` Actions secrets — if the private key is ever lost, generate a new pair with `npm run tauri signer generate`, update the pubkey, and re-set the secrets (older installs will then need a manual reinstall).

> macOS builds are unsigned for now — install via [Homebrew](#macos-homebrew-recommended) or clear the quarantine flag manually (see [Install](#install)). In-app updates still work (the updater verifies its own minisign signature). On Linux only the AppImage self-updates; `.deb`/`.rpm` users update through their package manager or manually.

## Project structure

```
src/
  ipc/        IPC contract, real Tauri bindings, and mocks for tests
  llm/        OpenRouter types, SSE accumulation, model filtering, agent loop
  tools/      Data-driven tool registry (add a tool without touching the loop)
  observe/    Sampler, "worth mentioning" heuristics, gate, runner
  store/      Zustand stores (chat, settings, observation) + persona / companion resolution
  windows/    Avatar / Bubble / Chat windows, plus PetSprite / petAtlas (spritesheet rendering)
  components/ Composer, message list, tool-call cards, settings dialog
  i18n/       Locales: en, zh-TW, zh-CN, ja
src-tauri/
  src/        Rust capabilities: llm, capture, context, settings, tools, skills, pets
```

## Notes

- **macOS private API** — `macOSPrivateApi` is enabled in `tauri.conf.json` to support the transparent, borderless windows.
- **exFAT volumes** — if the repo lives on an exFAT drive, macOS creates AppleDouble (`._*`) files that break the Tauri build. The `predev`/`prebuild` hooks clean them automatically (`npm run clean:appledouble`).

## Roadmap

Directional, not a promise — issues and PRs against any of it are welcome.

### 0.4 — Memory & persistence

Today Sage forgets everything on restart, which no companion should. This release extends the config-dir philosophy already used by `skills/` and `pets/`: **the config dir becomes Sage's brain**, and every piece of it stays a plain local file you can read, edit, or delete.

- **Conversation persistence** — Sage keeps one continuous conversation (a companion has an ongoing relationship, not a chat-app session list) that survives restarts. "Clear" archives the conversation to `<app config dir>/sessions/` instead of destroying it; archives are browsable and deletable from Settings.
- **Long-term memory** — one markdown file per memory under `<app config dir>/memory/`, with the same frontmatter format as skills (`name` + `description`, body = the fact). A lightweight index (one line per memory) is injected into each request; full memories load on demand via a `recall_memory` tool — the same catalog-plus-lazy-load pattern as `use_skill`. The model manages its own memory through `save_memory` / `recall_memory` / `forget_memory` (exact-name match), and Settings gets a memory manager with per-item edit/delete plus one-click delete-all.
- **Bounded context** — long histories are tail-truncated to a budget before each request; only the memory index (never every body) rides along by default.
- Memory is on by default: the files never leave your machine, and memory content reaches your chosen LLM over the exact same path chat content already does. Turn it off in Settings if you'd rather Sage stay goldfish-brained.
- Memory tools wire into the OpenRouter backend first; the agent-CLI backend gets read-only memory injection to start.

### 0.5 — MCP & tools

An MCP client, so Sage plugs into the existing tool ecosystem instead of growing bespoke tools one by one — built on the tool-permission tiers that already exist. Combined with the agent-CLI backend, Sage moves from "a character that chats" toward "a desktop agent that can offer to do the thing it just watched you get stuck on."

### 0.6 — Local model backend

An Ollama backend so observation screenshots never leave the machine, completing the privacy story and removing the free-tier quota anxiety.

### 1.0 — Signing & ecosystem

macOS code signing + notarization (no more quarantine workarounds), a companion-sharing gallery, and general polish so non-technical users can install without friction.

## License

[MIT](LICENSE)
