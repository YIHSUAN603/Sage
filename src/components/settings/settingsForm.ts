// Shared types + helpers for the settings window's section components.
// Extracted from the former SettingsDialog so every section speaks the same
// draft/patch language.
import type { Settings } from "../../ipc/contract.ts";

/** Partial-update helper the window hands every section. */
export type PatchSettings = (patch: Partial<Settings>) => void;

/**
 * 模型清單載入介面（llm/models.ts 的 fetchFreeToolModels /
 * fetchFreeObserveModels）。載入失敗或回空陣列時，欄位退化成
 * 「手填 model id 的 text input」。
 */
export interface ModelOption {
  id: string;
  name: string;
  recommended?: boolean;
}
export type LoadModels = () => Promise<ModelOption[]>;

/** Sentinel select value that reveals the free-text model input. */
export const CUSTOM_MODEL = "__custom__";

/**
 * The selected pet's editable `sage` block, loaded from its pet.json.
 * Numeric fields stay strings so "" can mean "inherit the global setting".
 */
export interface PetSageDraft {
  id: string;
  displayName: string;
  persona: string;
  cooldown: string;
  maxPerHour: string;
  dirty: boolean;
}

/** "" or invalid ⇒ undefined (inherit); otherwise the parsed minutes (> 0). */
export function parseCooldown(raw: string): number | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** One blocklist entry per line; blanks dropped, whitespace trimmed. */
export function parseBlocklist(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** "" or invalid ⇒ undefined (inherit); 0 is kept — it means explicitly unlimited. */
export function parseMaxPerHour(raw: string): number | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Math.floor(Number(t));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// Neither CLI can enumerate available models, so these are curated aliases (they
// map to `--model`). Codex has no stable alias set — users type theirs (Custom…).
export const AGENT_MODEL_PRESETS: Record<
  Settings["agent_cli"],
  { value: string; label: string }[]
> = {
  claude: [
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
    { value: "haiku", label: "Haiku" },
    { value: "fable", label: "Fable" },
  ],
  codex: [],
};

/** Is `model` representable by the CLI's dropdown (empty = default, or a preset)? */
export function isModelPreset(cli: Settings["agent_cli"], model: string): boolean {
  return model === "" || AGENT_MODEL_PRESETS[cli].some((p) => p.value === model);
}

export function sortRecommendedFirst(models: ModelOption[]): ModelOption[] {
  return [...models].sort(
    (a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false),
  );
}
