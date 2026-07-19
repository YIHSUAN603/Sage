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
  api_key: string;
  /** Model used for chat + tool calling (must support `tools`). */
  chat_model: string;
  /** Model used to observe the screen (must accept image input). May equal chat_model. */
  observe_model: string;
  /** Master switch for the observation subsystem. Off by default (privacy). */
  observe_enabled: boolean;
  /** Seconds between active-window polls when observing. */
  observe_interval: number;
  /** Optional OpenRouter ranking header. */
  referer: string;
  /** UI + assistant language: "auto" (follow system) or zh-TW / en / zh-CN / ja. */
  language: string;
}

/** Must stay in sync with `impl Default for Settings` in settings.rs. */
export const DEFAULT_SETTINGS: Settings = {
  api_key: "",
  chat_model: "",
  observe_model: "",
  observe_enabled: false,
  observe_interval: 8,
  referer: "https://github.com/sage",
  language: "auto",
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
  toolReadFile: "tool_read_file",
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
  /** Read a local UTF-8 file (≤256KB). Rejects with a message on failure. */
  toolReadFile(path: string): Promise<string>;
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<void>;
  /** Capture the main screen as a JPEG data URL. Rejects when observe_enabled is false. */
  captureScreen(): Promise<string>;
  /** Frontmost app + window title, or null when unavailable. */
  activeWindow(): Promise<ActiveWindow | null>;
}
