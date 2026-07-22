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
  api_key: string;
  /** Model used for chat + tool calling (must support `tools`). */
  chat_model: string;
  /** Model used to observe the screen (must accept image input). May equal chat_model. */
  observe_model: string;
  /** Master switch for the observation subsystem. Off by default (privacy). */
  observe_enabled: boolean;
  /** Seconds between active-window polls when observing. */
  observe_interval: number;
  /**
   * User-added sensitive-window entries (app names / title keywords),
   * case-insensitive substrings. Extends the built-in blocklist in
   * src-tauri/src/privacy.rs — blocklisted windows are never screenshotted
   * and their titles are masked.
   */
  observe_blocklist: string[];
  /**
   * What capture_screen grabs: "window" (focused window only, default —
   * background windows never enter the frame) or "screen" (full monitor).
   */
  observe_capture_mode: "window" | "screen";
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
}

/** Must stay in sync with `impl Default for Settings` in settings.rs. */
export const DEFAULT_SETTINGS: Settings = {
  backend: "openrouter",
  agent_cli: "claude",
  agent_cli_path: "",
  agent_cli_model: "",
  agent_cli_permission: "read_only",
  api_key: "",
  chat_model: "",
  observe_model: "",
  observe_enabled: false,
  observe_interval: 8,
  observe_blocklist: [],
  observe_capture_mode: "window",
  observe_deny_data_collection: true,
  referer: "https://github.com/sage",
  language: "auto",
  active_pet: "",
  custom_persona: "",
  proactive_cooldown_minutes: 2,
  proactive_max_per_hour: 0,
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
  listPets: "list_pets",
  readPet: "read_pet",
  readPetAtlas: "read_pet_atlas",
  importPet: "import_pet",
  updatePetSage: "update_pet_sage",
  getSettings: "get_settings",
  setSettings: "set_settings",
  captureScreen: "capture_screen",
  activeWindow: "active_window",
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
  checkAgentCli(cli: AgentRequest["cli"], path: string): Promise<string>;
  /** Read a local UTF-8 file (≤256KB). Rejects with a message on failure. */
  toolReadFile(path: string): Promise<string>;
  /** Installed skills' metadata (scans <config_dir>/skills/, creating it if needed). */
  listSkills(): Promise<SkillMeta[]>;
  /** One skill's SKILL.md body (frontmatter stripped). Rejects when the name is unknown. */
  readSkill(name: string): Promise<string>;
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
  /** Capture the main screen as a JPEG data URL. Rejects when observe_enabled is false. */
  captureScreen(): Promise<string>;
  /** Frontmost app + window title, or null when unavailable. */
  activeWindow(): Promise<ActiveWindow | null>;
}
