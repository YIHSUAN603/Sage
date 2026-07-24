// In-memory SageIpc for Node tests and offline frontend development.
// Only `import type` from the contract — zero runtime dependencies — so it
// runs under `node --experimental-strip-types` without a bundler.
import type {
  ActiveWindow,
  AgentActivity,
  AgentRequest,
  AgentStreamEvent,
  ArchiveMeta,
  ChatMessage,
  ChatRequest,
  MemoryMeta,
  Pet,
  PetMeta,
  SageIpc,
  SemanticSnapshot,
  Settings,
  SkillMeta,
  StreamEvent,
} from "./contract.ts";
import { DEFAULT_SETTINGS } from "./contract.ts";

export interface MockIpcOptions {
  /** One StreamEvent sequence per chatStream call, consumed in order. */
  script?: StreamEvent[][];
  /** One AgentStreamEvent sequence per agentStream call, consumed in order. */
  agentScript?: AgentStreamEvent[][];
  /** Fake filesystem for toolReadFile. */
  files?: Record<string, string>;
  /** Installed skills for listSkills/readSkill. Defaults to none. */
  skills?: MockSkill[];
  /** Saved memories for listMemories/readMemory. Defaults to none. */
  memories?: MockMemory[];
  /** Initial persisted conversation for loadSession. Defaults to empty. */
  session?: ChatMessage[];
  /** Seed archives for listArchives/readArchive, keyed by id. Defaults to none. */
  archives?: Record<string, ChatMessage[]>;
  /** Installed pets for listPets/readPet. Defaults to none. */
  pets?: Pet[];
  /** Data URL returned by readPetAtlas (any pet id). */
  petAtlas?: string;
  /** Pet returned by importPet; when absent, importPet resolves null (cancelled). */
  importResult?: PetMeta;
  /** Initial settings (merged over DEFAULT_SETTINGS). */
  settings?: Partial<Settings>;
  /** activeWindow results, cycled per call. Defaults to [null]. */
  windows?: (ActiveWindow | null)[];
  /** Fields merged over DEFAULT_SNAPSHOT for semanticSnapshot results. */
  snapshot?: Partial<SemanticSnapshot>;
  /**
   * Simulate a blocklisted foreground window: semanticSnapshot rejects with
   * the same message semantic.rs uses ("sensitive window").
   */
  sensitiveWindow?: boolean;
  /**
   * Simulate an unsupported platform / missing accessibility permission:
   * semanticSnapshot rejects with this message.
   */
  semanticError?: string;
  /** idle_seconds returned by activityState. Defaults to 0 (active user). */
  idleSeconds?: number;
  /** AgentActivity returned by agentActivity. Defaults to null (no session). */
  agentActivity?: AgentActivity | null;
}

/** A skill as the mock stores it: contract SkillMeta plus its SKILL.md body. */
export interface MockSkill extends SkillMeta {
  body: string;
}

/** A memory as the mock stores it: contract MemoryMeta plus its body. */
export interface MockMemory extends MemoryMeta {
  body: string;
}

/** Match memory.rs's slug: lowercase, non-alphanumeric runs → "-", trimmed. */
function memorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface MockIpc extends SageIpc {
  /** Every call made, in order, for assertions. */
  calls: { command: string; args?: unknown }[];
  /** The requests chatStream received, in order. */
  chatRequests: ChatRequest[];
  /** The requests agentStream received, in order. */
  agentRequests: AgentRequest[];
}

/** A stream that answers "hi" — with the tool_call arguments sliced across
 * deltas the way OpenRouter actually sends them (exercises S2.1 accumulation). */
export const DEFAULT_SCRIPT: StreamEvent[][] = [
  [
    { type: "delta", content: "Let me look at that file." },
    {
      type: "delta",
      tool_calls: [
        { index: 0, id: "call_1", function: { name: "read_file", arguments: "" } },
      ],
    },
    { type: "delta", tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] },
    { type: "delta", tool_calls: [{ index: 0, function: { arguments: 'th":"/tmp' } }] },
    { type: "delta", tool_calls: [{ index: 0, function: { arguments: '/a.txt"}' } }] },
    { type: "done", finish_reason: "tool_calls" },
  ],
  [
    { type: "delta", content: "The file says " },
    { type: "delta", content: "hello." },
    { type: "done", finish_reason: "stop" },
  ],
];

/** An agent-CLI stream that reads a file then answers — mirrors how claude/codex
 * report a whole tool call + result rather than sliced deltas. */
export const DEFAULT_AGENT_SCRIPT: AgentStreamEvent[][] = [
  [
    { type: "delta", content: "Let me look at that file." },
    { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/tmp/a.txt" } },
    { type: "tool_result", id: "toolu_1", content: "hello." },
    { type: "delta", content: "The file says hello." },
    { type: "done", is_error: false },
  ],
];

/** A plausible focused-window reading; individual fields rarely matter in tests. */
export const DEFAULT_SNAPSHOT: SemanticSnapshot = {
  app_name: "Visual Studio Code",
  title: "gate.ts — Sage",
  focused_role: "AXTextArea",
  focused_value: "export function createBubbleGate(",
  selection: "",
  texts: ["gate.ts — Sage", "export function createBubbleGate("],
  truncated: false,
};

// 1×1 transparent PNG — stand-in for a pet spritesheet in tests.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoGF/+wAAAAASUVORK5CYII=";

export function createMockIpc(options: MockIpcOptions = {}): MockIpc {
  const script = options.script ?? DEFAULT_SCRIPT;
  const agentScript = options.agentScript ?? DEFAULT_AGENT_SCRIPT;
  const files = { ...(options.files ?? {}) };
  const skills = [...(options.skills ?? [])];
  const memories = [...(options.memories ?? [])];
  let session: ChatMessage[] = [...(options.session ?? [])];
  const archives = new Map<string, ChatMessage[]>(
    Object.entries(options.archives ?? {}).map(([id, msgs]) => [id, [...msgs]]),
  );
  const pets = [...(options.pets ?? [])];
  const petAtlas = options.petAtlas ?? TINY_PNG_DATA_URL;
  const windows = options.windows ?? [null];
  const snapshot: SemanticSnapshot = { ...DEFAULT_SNAPSHOT, ...(options.snapshot ?? {}) };
  let settings: Settings = { ...DEFAULT_SETTINGS, ...(options.settings ?? {}) };
  let streamCall = 0;
  let agentCall = 0;
  let windowCall = 0;

  const calls: MockIpc["calls"] = [];
  const chatRequests: ChatRequest[] = [];
  const agentRequests: AgentRequest[] = [];

  return {
    calls,
    chatRequests,
    agentRequests,

    async chatStream(req, onEvent, signal) {
      calls.push({ command: "chat_stream", args: req });
      chatRequests.push(req);
      const events = script[streamCall % script.length];
      streamCall += 1;
      for (const event of events) {
        if (signal?.aborted) return;
        onEvent(event);
        // Yield between events so consumers see them asynchronously, like a
        // real SSE stream, and abort can land mid-stream.
        await Promise.resolve();
      }
    },

    async agentStream(req, onEvent, signal) {
      calls.push({ command: "agent_stream", args: req });
      agentRequests.push(req);
      const events = agentScript[agentCall % agentScript.length];
      agentCall += 1;
      for (const event of events) {
        if (signal?.aborted) return;
        onEvent(event);
        await Promise.resolve();
      }
    },

    async checkAgentCli(cli, path, useWsl, distro) {
      calls.push({ command: "check_agent_cli", args: { cli, path, useWsl, distro } });
      return `${cli} (mock)`;
    },

    async toolReadFile(path) {
      calls.push({ command: "tool_read_file", args: path });
      if (!(path in files)) {
        // Same message shape as tools.rs
        throw new Error(`file not found: ${path}`);
      }
      return files[path];
    },

    async listSkills() {
      calls.push({ command: "list_skills" });
      return skills.map(({ name, description }) => ({ name, description }));
    },

    async readSkill(name) {
      calls.push({ command: "read_skill", args: name });
      const skill = skills.find((s) => s.name === name);
      // Same message shape as skills.rs
      if (!skill) throw new Error(`skill not found: ${name}`);
      return skill.body;
    },

    async listMemories() {
      calls.push({ command: "list_memories" });
      return memories.map(({ name, description }) => ({ name, description }));
    },

    async readMemory(name) {
      calls.push({ command: "read_memory", args: name });
      const memory = memories.find((m) => m.name === name);
      // Same message shape as memory.rs
      if (!memory) throw new Error(`memory not found: ${name}`);
      return memory.body;
    },

    async saveMemory(name, description, body) {
      calls.push({ command: "save_memory", args: { name, description, body } });
      if (!memorySlug(name)) throw new Error(`invalid memory name: ${name}`);
      // Overwrite by parsed name (mirrors the slug-file overwrite in memory.rs).
      const existing = memories.find((m) => m.name === name);
      if (existing) {
        existing.description = description;
        existing.body = body;
      } else {
        memories.push({ name, description, body });
      }
    },

    async forgetMemory(name) {
      calls.push({ command: "forget_memory", args: name });
      const idx = memories.findIndex((m) => m.name === name);
      // Same message shape as memory.rs
      if (idx < 0) throw new Error(`memory not found: ${name}`);
      memories.splice(idx, 1);
    },

    async loadSession() {
      calls.push({ command: "load_session" });
      return session.map((m) => ({ ...m }));
    },

    async saveSession(messages) {
      calls.push({ command: "save_session", args: messages });
      session = messages.map((m) => ({ ...m }));
    },

    async archiveSession() {
      calls.push({ command: "archive_session" });
      if (session.length === 0) return null; // nothing to archive
      const id = `mock-${archives.size + 1}`;
      archives.set(id, session);
      const meta: ArchiveMeta = {
        id,
        saved_at: new Date().toISOString(),
        message_count: session.length,
      };
      session = [];
      return meta;
    },

    async listArchives() {
      calls.push({ command: "list_archives" });
      // Newest first (insertion order reversed) — mirrors sessions.rs sort.
      return [...archives.entries()].reverse().map(([id, msgs]) => ({
        id,
        saved_at: id,
        message_count: msgs.length,
      }));
    },

    async readArchive(id) {
      calls.push({ command: "read_archive", args: id });
      const msgs = archives.get(id);
      // Same message shape as sessions.rs
      if (!msgs) throw new Error(`archive not found: ${id}`);
      return msgs.map((m) => ({ ...m }));
    },

    async deleteArchive(id) {
      calls.push({ command: "delete_archive", args: id });
      if (!archives.delete(id)) throw new Error(`archive not found: ${id}`);
    },

    async listPets() {
      calls.push({ command: "list_pets" });
      return pets.map(({ id, displayName, description }) => ({
        id,
        displayName,
        description,
      }));
    },

    async readPet(id) {
      calls.push({ command: "read_pet", args: id });
      const pet = pets.find((p) => p.id === id);
      // Same message shape as pets.rs
      if (!pet) throw new Error(`pet not found: ${id}`);
      return { ...pet };
    },

    async readPetAtlas(id) {
      calls.push({ command: "read_pet_atlas", args: id });
      if (!pets.some((p) => p.id === id)) throw new Error(`pet not found: ${id}`);
      return petAtlas;
    },

    async importPet() {
      calls.push({ command: "import_pet" });
      if (!options.importResult) return null; // simulate a cancelled picker
      const pet = options.importResult;
      // Mirror the backend overwrite: replace any existing pet with this id,
      // then make it discoverable via a subsequent listPets/readPet.
      const idx = pets.findIndex((p) => p.id === pet.id);
      const full: Pet = { spritesheetPath: "spritesheet.webp", ...pet };
      if (idx >= 0) pets[idx] = full;
      else pets.push(full);
      return { id: pet.id, displayName: pet.displayName, description: pet.description };
    },

    async updatePetSage(id, persona, proactive) {
      calls.push({ command: "update_pet_sage", args: { id, persona, proactive } });
      const pet = pets.find((p) => p.id === id);
      // Same message shape as pets.rs
      if (!pet) throw new Error(`pet not found: ${id}`);
      // Mirror the backend: blank persona / absent numbers remove the keys.
      if (persona.trim()) pet.persona = persona;
      else delete pet.persona;
      const next: typeof pet.proactive = {};
      if (proactive.cooldownMinutes !== undefined) {
        next.cooldownMinutes = proactive.cooldownMinutes;
      }
      if (proactive.maxPerHour !== undefined) next.maxPerHour = proactive.maxPerHour;
      if (Object.keys(next).length > 0) pet.proactive = next;
      else delete pet.proactive;
    },

    async getSettings() {
      calls.push({ command: "get_settings" });
      return { ...settings };
    },

    async setSettings(next) {
      calls.push({ command: "set_settings", args: next });
      settings = { ...next };
    },

    async semanticSnapshot() {
      calls.push({ command: "semantic_snapshot" });
      // Mirrors semantic.rs: refuse outright when observation is off.
      if (!settings.observe_enabled) {
        throw new Error("observation disabled");
      }
      // Mirrors semantic.rs's privacy gate for a blocklisted foreground window.
      if (options.sensitiveWindow) {
        throw new Error("sensitive window");
      }
      // Unsupported platform / missing accessibility permission.
      if (options.semanticError) {
        throw new Error(options.semanticError);
      }
      return { ...snapshot, texts: [...snapshot.texts] };
    },

    async activityState() {
      calls.push({ command: "activity_state" });
      return { idle_seconds: options.idleSeconds ?? 0 };
    },

    async activeWindow() {
      calls.push({ command: "active_window" });
      const win = windows[windowCall % windows.length];
      windowCall += 1;
      return win === null ? null : { ...win };
    },

    async agentActivity() {
      calls.push({ command: "agent_activity" });
      const a = options.agentActivity ?? null;
      return a === null ? null : { ...a, texts: [...a.texts] };
    },
  };
}
