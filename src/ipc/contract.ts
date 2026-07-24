// Frozen IPC contract between the React frontend and the Tauri (Rust) backend.
// This file is the shared interface for all parallel tracks (Gate A in PLAN.md):
// pure types + command name constants only — no runtime imports — so Node tests
// can depend on it without pulling in @tauri-apps/api.
//
// Changing anything here requires syncing every track. Treat as read-only.

// ---------------------------------------------------------------------------
// Settings — mirrors src-tauri/src/settings.rs (serde default = snake_case)
// ---------------------------------------------------------------------------

export interface Settings {
  /**
   * Which LLM backend drives chat + observation.
   * "openrouter" (default) uses the OpenRouter HTTP API; "agent_cli" shells out
   * to a local agent CLI (`agent_cli`) that runs its own read-only tool loop.
   */
  backend: "openrouter" | "agent_cli";
  /** Which agent CLI to use when backend === "agent_cli". */
  agent_cli: "claude" | "codex";
  /** Optional absolute path to the agent CLI binary; empty ⇒ resolve on PATH. */
  agent_cli_path: string;
  /** Model to pass the agent CLI (claude --model / codex -m); empty ⇒ CLI default. */
  agent_cli_model: string;
  /**
   * Tool permission tier for agent-CLI chat. Observation is always read-only.
   * "read_only": read/search tools only; "edit": file edits + skills, no
   * arbitrary commands; "full": everything, including shell commands.
   */
  agent_cli_permission: "read_only" | "edit" | "full";
  /**
   * Invoke the agent CLI through `wsl.exe` (Windows only) so Sage, a native
   * Windows app, can reach a claude/codex installed inside WSL. Put the WSL
   * Linux path in `agent_cli_path`.
   */
  agent_cli_use_wsl: boolean;
  /** WSL distro to run the CLI in when agent_cli_use_wsl; empty ⇒ default distro. */
  agent_cli_wsl_distro: string;
  api_key: string;
  /** Model used for chat + tool calling (must support `tools`). */
  chat_model: string;
  /** Model used for observation (text-only prompts). May equal chat_model. */
  observe_model: string;
  /**
   * Master switch for the observation subsystem (window sampling, semantic
   * snapshots, chat context injection). Off by default (privacy).
   */
  observe_enabled: boolean;
  /**
   * Master switch for proactive bubbles, independent of observation:
   * both on ⇒ the companion chats about what it sees; proactive only ⇒ blind
   * small talk (nothing is ever captured); observe only ⇒ silent observation,
   * sampling feeds chat context but no bubble ever pops; both off ⇒ quiet.
   * On by default (pure companionship).
   */
  proactive_enabled: boolean;
  /** Seconds between active-window polls when observing. */
  observe_interval: number;
  /**
   * User-added sensitive-window entries (app names / title keywords),
   * case-insensitive substrings. Extends the built-in blocklist in
   * src-tauri/src/privacy.rs — blocklisted windows' content is never read
   * and their titles are masked.
   */
  observe_blocklist: string[];
  /**
   * Route observation requests only to OpenRouter providers that don't
   * retain/train on inputs (provider.data_collection = "deny"). May leave
   * some free models without an eligible provider; observation then falls
   * back to title-only.
   */
  observe_deny_data_collection: boolean;
  /** Optional OpenRouter ranking header. */
  referer: string;
  /** UI + assistant language: "auto" (follow system) or zh-TW / en / zh-CN / ja. */
  language: string;
  /** Selected companion id (folder under <config>/pets/). Empty = built-in Sage. */
  active_pet: string;
  /** Custom persona for the built-in Sage companion. Empty = i18n default. */
  custom_persona: string;
  /** Minimum minutes between proactive asks; a pet's sage.proactive overrides. */
  proactive_cooldown_minutes: number;
  /** Max proactive bubbles per rolling hour; 0 = unlimited. Pet overrides. */
  proactive_max_per_hour: number;
  /**
   * Master switch for long-term memory: the memory index injected into each
   * request, the save/recall/forget tools, and startup conversation
   * persistence. On by default — files never leave the machine and memory
   * content travels the same LLM path chat content already does.
   */
  memory_enabled: boolean;
  /**
   * Observe the user's own coding-agent sessions (Claude Code / Codex): tail
   * their transcript JSONL so the companion can react to what they're doing in
   * the terminal, and (Claude) install a hook for prompt/permission/stop
   * signals. Off by default — reads ~/.claude and ~/.codex. Independent of
   * observe_enabled (screen observation).
   */
  observe_agents: boolean;
  /**
   * Let the companion move around the desktop on its own. With observation on,
   * the model decides where to go (riding the proactive compose call); with it
   * off, the pet just ambles at random. Off by default. No-op where the
   * compositor forbids programmatic window moves (Wayland/WSLg).
   */
  wander_enabled: boolean;
}

/** Must stay in sync with `impl Default for Settings` in settings.rs. */
export const DEFAULT_SETTINGS: Settings = {
  backend: "openrouter",
  agent_cli: "claude",
  agent_cli_path: "",
  agent_cli_model: "",
  agent_cli_permission: "read_only",
  agent_cli_use_wsl: false,
  agent_cli_wsl_distro: "",
  api_key: "",
  chat_model: "",
  observe_model: "",
  observe_enabled: false,
  proactive_enabled: true,
  observe_interval: 8,
  observe_blocklist: [],
  observe_deny_data_collection: true,
  referer: "https://github.com/sage",
  language: "auto",
  active_pet: "",
  custom_persona: "",
  proactive_cooldown_minutes: 1,
  proactive_max_per_hour: 0,
  memory_enabled: true,
  observe_agents: false,
  wander_enabled: false,
};

// ---------------------------------------------------------------------------
// Chat messages — OpenAI-compatible shapes accepted by OpenRouter
// ---------------------------------------------------------------------------

export interface TextPart {
  type: "text";
  text: string;
}

/** `url` is a data URL (e.g. "data:image/jpeg;base64,...") for vision models. */
export interface ImagePart {
  type: "image_url";
  image_url: { url: string };
}

export type ContentPart = TextPart | ImagePart;

export type Role = "system" | "user" | "assistant" | "tool";

/** A completed tool call on an assistant message. `arguments` is a JSON string. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: Role;
  /** string for plain text; ContentPart[] when mixing text and images; null on assistant messages that only carry tool_calls. */
  content: string | ContentPart[] | null;
  /** Present on assistant messages that request tool execution. */
  tool_calls?: ToolCall[];
  /** Present on role:"tool" messages — the ToolCall id being answered. */
  tool_call_id?: string;
  /**
   * UI-only metadata: when the message landed (epoch ms). Stamped by the chat
   * store, persisted with the session, stripped before any request reaches a
   * model. Absent on messages saved before 0.5 — the UI then shows no time.
   */
  ts?: number;
}

/** OpenRouter `tools` array entry (what tools/registry.ts produces). */
export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    /** JSON Schema for the arguments object. */
    parameters: Record<string, unknown>;
  };
}

/** Request body for `chat_stream` (backend adds stream:true and auth). */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  /**
   * "deny" ⇒ Rust adds provider.data_collection = "deny" to the OpenRouter
   * body (only zero-retention providers may serve the request). Set by the
   * observation path when observe_deny_data_collection is on.
   */
  data_policy?: "deny";
}

// ---------------------------------------------------------------------------
// Stream events — what `chat_stream` emits over a Tauri Channel, one per SSE
// delta. Input format for llm/openrouter.ts `accumulateDeltas()`.
// ---------------------------------------------------------------------------

/**
 * A fragment of a tool call. `function.arguments` arrives sliced across many
 * deltas and must be concatenated by `index`.
 */
export interface ToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

export type StreamErrorKind = "auth" | "rate_limit" | "network" | "api";

export type StreamEvent =
  | { type: "delta"; content?: string; tool_calls?: ToolCallDelta[] }
  | { type: "done"; finish_reason: string | null }
  | { type: "error"; kind: StreamErrorKind; status?: number; message: string };

// ---------------------------------------------------------------------------
// Agent-CLI stream — what `agent_stream` emits over a Tauri Channel. Unlike the
// OpenAI-style StreamEvent, a local agent CLI (claude / codex) runs its own tool
// loop, so it reports whole tool calls and results rather than sliced deltas.
// A Rust adapter maps each CLI's native JSON stream onto this shape.
// ---------------------------------------------------------------------------

export type AgentStreamEvent =
  /** A fragment of streamed assistant text. */
  | { type: "delta"; content: string }
  /** The CLI invoked one of its own tools. `input` is the raw arguments object. */
  | { type: "tool_use"; id: string; name: string; input: unknown }
  /** The result of a prior tool_use (same `id`). `content` is already stringified. */
  | { type: "tool_result"; id: string; content: string; is_error?: boolean }
  /** The turn finished. */
  | { type: "done"; is_error?: boolean }
  /** Spawn / not-found / auth failure — the CLI never produced a usable turn. */
  | { type: "error"; kind: StreamErrorKind; message: string };

/** Request body for `agent_stream`. `purpose` lets observe run tool-free + terse. */
export interface AgentRequest {
  cli: "claude" | "codex";
  messages: ChatMessage[];
  purpose: "chat" | "observe";
  /** Model override for the CLI; empty ⇒ the CLI's own default. */
  model: string;
}

// ---------------------------------------------------------------------------
// Skills — mirrors src-tauri/src/skills.rs. A skill is a folder under
// <app_config_dir>/skills/ containing a SKILL.md (optional frontmatter:
// name + description) whose body the model loads on demand via `use_skill`.
// ---------------------------------------------------------------------------

export interface SkillMeta {
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Memory — mirrors src-tauri/src/memory.rs. A memory is one markdown file under
// <app_config_dir>/memory/ with the same frontmatter format as skills
// (name + description), body = the fact. A lightweight index (one line per
// memory) rides into each request; full bodies load on demand via recall_memory
// — the same catalog-plus-lazy-load pattern as use_skill.
// ---------------------------------------------------------------------------

export interface MemoryMeta {
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Sessions — mirrors src-tauri/src/sessions.rs. The single continuous
// conversation is persisted to <app_config_dir>/session.json; "clear" archives
// it to <app_config_dir>/sessions/<id>.json (browsable/deletable from Settings).
// Conversation payloads travel as opaque ChatMessage[] (Rust stores raw JSON).
// ---------------------------------------------------------------------------

export interface ArchiveMeta {
  /** Archive id = filename stem (a sortable timestamp). */
  id: string;
  /** When the archive was created (derived from id or file mtime). */
  saved_at: string;
  /** Number of messages in the archived conversation (0 if unparseable). */
  message_count: number;
}

// ---------------------------------------------------------------------------
// Pets (companions) — mirrors src-tauri/src/pets.rs. A pet is a folder under
// <app_config_dir>/pets/ following the Codex pet contract that OpenAI's
// `hatch-pet` skill emits: a pet.json (id / displayName / description /
// spritesheetPath) + a spritesheet image. `persona` / `proactive` come from
// the optional additive `sage` block; a plain hatch-pet folder omits them and
// Sage falls back to a synthesized persona + default proactive tuning.
// ---------------------------------------------------------------------------

export interface PetMeta {
  id: string;
  displayName: string;
  description: string;
}

/** Numeric proactive-chatter overrides (from pet.json's `sage.proactive`). */
export interface PetProactive {
  cooldownMinutes?: number;
  maxPerHour?: number;
}

/** Manual theme override (from pet.json's `sage.theme`). */
export interface PetTheme {
  /** Accent as #rrggbb; absent ⇒ the UI auto-extracts a hue from the sprite. */
  accent?: string;
}

/** A fully parsed pet manifest. */
export interface Pet extends PetMeta {
  spritesheetPath: string;
  /** Custom system prompt; absent ⇒ Sage synthesizes one from name+description. */
  persona?: string;
  proactive?: PetProactive;
  theme?: PetTheme;
}

// ---------------------------------------------------------------------------
// Observation context
// ---------------------------------------------------------------------------

export interface ActiveWindow {
  app_name: string;
  title: string;
}

/**
 * Structured text read from the focused window via the platform accessibility
 * API (macOS AX / Windows UIA) — the screenshot's replacement. Every string is
 * sanitized (privacy.rs) and size-capped before it leaves Rust. Empty string /
 * empty array = the platform exposed nothing for that field.
 */
export interface SemanticSnapshot {
  app_name: string;
  title: string;
  /** Accessibility role of the focused element (e.g. "AXTextArea", "Edit"). */
  focused_role: string;
  /** Text value of the focused element. */
  focused_value: string;
  /** Currently selected text, when the platform exposes it. */
  selection: string;
  /** Visible text fragments collected from the focused window, top-down. */
  texts: string[];
  /** True when the size caps trimmed the collected text. */
  truncated: boolean;
}

/** Lightweight user-activity signal. No permissions required on any platform. */
export interface ActivityState {
  /** Seconds since the last keyboard/mouse input; 0 when undetectable. */
  idle_seconds: number;
}

/**
 * A snapshot of the user's *own* coding-agent session (Claude Code / Codex),
 * read from the transcript JSONL each CLI writes to disk. Every string is
 * sanitized (privacy.rs) and length-capped before it leaves Rust. Null from the
 * IPC = feature off, no session, or nothing readable.
 */
export interface AgentActivity {
  /** Which CLI this reflects. */
  source: "claude" | "codex";
  /** Session identifier (transcript filename stem). */
  session: string;
  /** Coarse turn state — "waiting_permission" only ever comes from the hook. */
  state: "running" | "idle" | "waiting_permission";
  /** Recent turn text (prompts + replies), oldest→newest, each prefixed by role. */
  texts: string[];
  /** Last tool action, human-readable (e.g. "Read: /path", "shell: pwd"), or null. */
  tool: string | null;
  /** Semantic class of the last tool, letting the companion react to what the
   * agent is doing rather than only whether it's running. */
  action: "editing" | "testing" | "reading" | "searching" | "executing" | null;
  /** Transcript mtime, epoch milliseconds. */
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export const COMMANDS = {
  chatStream: "chat_stream",
  agentStream: "agent_stream",
  checkAgentCli: "check_agent_cli",
  toolReadFile: "tool_read_file",
  listSkills: "list_skills",
  readSkill: "read_skill",
  listMemories: "list_memories",
  readMemory: "read_memory",
  saveMemory: "save_memory",
  forgetMemory: "forget_memory",
  loadSession: "load_session",
  saveSession: "save_session",
  archiveSession: "archive_session",
  listArchives: "list_archives",
  readArchive: "read_archive",
  deleteArchive: "delete_archive",
  listPets: "list_pets",
  readPet: "read_pet",
  readPetAtlas: "read_pet_atlas",
  importPet: "import_pet",
  updatePetSage: "update_pet_sage",
  getSettings: "get_settings",
  setSettings: "set_settings",
  semanticSnapshot: "semantic_snapshot",
  activityState: "activity_state",
  activeWindow: "active_window",
  agentActivity: "agent_activity",
} as const;

/**
 * The full IPC surface. `src/ipc/real.ts` implements it over Tauri invoke;
 * `src/ipc/mock.ts` implements it in-memory for Node tests.
 */
export interface SageIpc {
  /**
   * Stream one chat completion. Events arrive via `onEvent` until a "done" or
   * "error" event; the promise settles when the stream ends. `signal` aborts
   * consumption on the frontend side (the composer's AbortController).
   */
  chatStream(
    req: ChatRequest,
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  /**
   * Stream one turn from a local agent CLI (claude / codex). The CLI runs its
   * own read-only tool loop; events arrive via `onEvent` until "done" or "error".
   * `signal` aborts consumption on the frontend side.
   */
  agentStream(
    req: AgentRequest,
    onEvent: (event: AgentStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  /**
   * Probe an agent CLI (`<bin> --version`). Resolves with its version string, or
   * rejects when the binary can't be found/run. `path` empty ⇒ resolve on PATH.
   */
  checkAgentCli(
    cli: AgentRequest["cli"],
    path: string,
    useWsl: boolean,
    distro: string,
  ): Promise<string>;
  /** Read a local UTF-8 file (≤256KB). Rejects with a message on failure. */
  toolReadFile(path: string): Promise<string>;
  /** Installed skills' metadata (scans <config_dir>/skills/, creating it if needed). */
  listSkills(): Promise<SkillMeta[]>;
  /** One skill's SKILL.md body (frontmatter stripped). Rejects when the name is unknown. */
  readSkill(name: string): Promise<string>;
  /** Saved memories' metadata (scans <config_dir>/memory/, creating it if needed). */
  listMemories(): Promise<MemoryMeta[]>;
  /** One memory's body (frontmatter stripped). Rejects when the name is unknown. */
  readMemory(name: string): Promise<string>;
  /**
   * Write (or overwrite) one memory. The filename is a safe slug derived from
   * `name`; an existing memory with the same parsed `name` is overwritten
   * (used for edits). Rejects when `name` has no slug-able characters.
   */
  saveMemory(name: string, description: string, body: string): Promise<void>;
  /** Delete one memory by exact parsed name. Rejects when the name is unknown. */
  forgetMemory(name: string): Promise<void>;
  /** The persisted continuous conversation (empty array when none saved). */
  loadSession(): Promise<ChatMessage[]>;
  /** Overwrite the persisted conversation. */
  saveSession(messages: ChatMessage[]): Promise<void>;
  /**
   * Archive the current conversation to <config>/sessions/ and clear it.
   * Resolves with the new archive's metadata, or null when there was nothing
   * to archive (no saved conversation, or an empty one).
   */
  archiveSession(): Promise<ArchiveMeta | null>;
  /** Archived conversations' metadata, newest first. */
  listArchives(): Promise<ArchiveMeta[]>;
  /** One archived conversation's messages. Rejects when the id is unknown. */
  readArchive(id: string): Promise<ChatMessage[]>;
  /** Delete one archive by id. Rejects when the id is unknown. */
  deleteArchive(id: string): Promise<void>;
  /** Installed pets' metadata (scans <config_dir>/pets/, creating it if needed). */
  listPets(): Promise<PetMeta[]>;
  /** One pet's fully parsed manifest. Rejects when the id is unknown. */
  readPet(id: string): Promise<Pet>;
  /** The pet's spritesheet as a data URL (data:image/webp;base64,...). Rejects on failure. */
  readPetAtlas(id: string): Promise<string>;
  /**
   * Prompt the user to pick a pet folder (a pet.json + spritesheet, as
   * hatch-pet emits) and copy it into <config>/pets/. Resolves with the
   * imported pet's metadata, or null if the user cancelled the picker.
   * Rejects when the chosen folder isn't a valid pet.
   */
  importPet(): Promise<PetMeta | null>;
  /**
   * Rewrite one pet's `sage` block in its pet.json. Blank persona / absent
   * proactive numbers remove the corresponding keys (fall back to synthesized
   * persona / global settings); every other manifest field is preserved.
   * Rejects when the id is unknown.
   */
  updatePetSage(id: string, persona: string, proactive: PetProactive): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<void>;
  /**
   * Read the focused window's text content via the platform accessibility API.
   * Rejects with "observation disabled" when observe_enabled is false, with
   * "sensitive window" for blocklisted windows, and with a guidance message
   * when the platform is unsupported or a permission is missing — the caller
   * falls back to title-only observation on any rejection.
   */
  semanticSnapshot(): Promise<SemanticSnapshot>;
  /** Seconds since the last user input. Never rejects; unknown ⇒ 0. */
  activityState(): Promise<ActivityState>;
  /** Frontmost app + window title, or null when unavailable. */
  activeWindow(): Promise<ActiveWindow | null>;
  /**
   * Current coding-agent activity (Claude Code / Codex), or null when
   * observe_agents is off, no session exists, or nothing could be read. Never
   * rejects — a companion signal degrades to silence, never to an error.
   */
  agentActivity(): Promise<AgentActivity | null>;
}
