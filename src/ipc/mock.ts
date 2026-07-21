// In-memory SageIpc for Node tests and offline frontend development.
// Only `import type` from the contract — zero runtime dependencies — so it
// runs under `node --experimental-strip-types` without a bundler.
import type {
  ActiveWindow,
  AgentRequest,
  AgentStreamEvent,
  ChatRequest,
  Pet,
  PetMeta,
  SageIpc,
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
  /** Data URL returned by captureScreen. */
  screenshot?: string;
}

/** A skill as the mock stores it: contract SkillMeta plus its SKILL.md body. */
export interface MockSkill extends SkillMeta {
  body: string;
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

// Smallest useful stand-in for a real capture; content never matters in tests.
const TINY_JPEG_DATA_URL =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

// 1×1 transparent PNG — stand-in for a pet spritesheet in tests.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoGF/+wAAAAASUVORK5CYII=";

export function createMockIpc(options: MockIpcOptions = {}): MockIpc {
  const script = options.script ?? DEFAULT_SCRIPT;
  const agentScript = options.agentScript ?? DEFAULT_AGENT_SCRIPT;
  const files = { ...(options.files ?? {}) };
  const skills = [...(options.skills ?? [])];
  const pets = [...(options.pets ?? [])];
  const petAtlas = options.petAtlas ?? TINY_PNG_DATA_URL;
  const windows = options.windows ?? [null];
  const screenshot = options.screenshot ?? TINY_JPEG_DATA_URL;
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

    async checkAgentCli(cli, path) {
      calls.push({ command: "check_agent_cli", args: { cli, path } });
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

    async getSettings() {
      calls.push({ command: "get_settings" });
      return { ...settings };
    },

    async setSettings(next) {
      calls.push({ command: "set_settings", args: next });
      settings = { ...next };
    },

    async captureScreen() {
      calls.push({ command: "capture_screen" });
      // Mirrors capture.rs: refuse outright when observation is off.
      if (!settings.observe_enabled) {
        throw new Error("observation disabled");
      }
      return screenshot;
    },

    async activeWindow() {
      calls.push({ command: "active_window" });
      const win = windows[windowCall % windows.length];
      windowCall += 1;
      return win === null ? null : { ...win };
    },
  };
}
