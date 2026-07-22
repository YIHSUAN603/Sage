// S2.2 — Fetch the OpenRouter model list and filter by capability.
// `fetchFn` is injectable so tests never hit the network.

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Raw shape of one entry in OpenRouter's GET /api/v1/models response. */
export interface OpenRouterModel {
  id: string;
  name: string;
  /** Prices are strings; a model is free only when every price is "0". */
  pricing?: Record<string, string | undefined>;
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
}

/** A model that passed a capability filter, ready for a settings dropdown. */
export interface ModelChoice {
  id: string;
  name: string;
  /**
   * Observe dropdown only: true when the model also supports `tools`, so the
   * same model can serve both the chat and observe slots. Always false in the
   * chat list (every entry there is dual-capable — observation is text-only).
   */
  recommended: boolean;
}

/** Minimal fetch surface — `globalThis.fetch` satisfies it. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

function isFree(model: OpenRouterModel): boolean {
  // prompt 免費不等於全免費——completion/request/image 等任何一項計費就不算。
  const pricing = model.pricing;
  if (!pricing) return false;
  const prices = Object.values(pricing).filter((v): v is string => v != null);
  return prices.length > 0 && prices.every((v) => Number(v) === 0);
}

function supportsTools(model: OpenRouterModel): boolean {
  return (model.supported_parameters ?? []).includes("tools");
}


// 安全審查/內容分類模型（Llama Guard、Nemotron Content Safety…）只會輸出
// 「safe/unsafe」之類的標籤，不能聊天也不能描述畫面。OpenRouter 沒有結構化
// 欄位可辨識，只能比對 id/name（實測 2026-07：content-safety 模型的
// output_modalities 一樣是 ["text"]，靠 modality 擋不住）。
const CLASSIFIER_PATTERN = /guard|safety|moderat|shield|classif/i;

function isClassifier(model: OpenRouterModel): boolean {
  return CLASSIFIER_PATTERN.test(model.id) || CLASSIFIER_PATTERN.test(model.name ?? "");
}

/** 聊天/觀察都需要文字回覆；音樂、影像生成模型直接排除。缺欄位時放行。 */
function outputsText(model: OpenRouterModel): boolean {
  const out = model.architecture?.output_modalities;
  return !out || out.includes("text");
}

/** The baseline every dropdown entry must pass, regardless of capability. */
function isUsable(model: OpenRouterModel): boolean {
  return isFree(model) && outputsText(model) && !isClassifier(model);
}

async function fetchModels(fetchFn: FetchLike): Promise<OpenRouterModel[]> {
  const res = await fetchFn(OPENROUTER_MODELS_URL);
  if (!res.ok) {
    throw new Error(`openrouter models request failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data?: unknown };
  if (!Array.isArray(body?.data)) {
    throw new Error("openrouter models response missing data array");
  }
  return body.data as OpenRouterModel[];
}

function toChoice(model: OpenRouterModel, recommended: boolean): ModelChoice {
  return { id: model.id, name: model.name, recommended };
}

/** Free models usable for chat + function calling (`tools`). */
export async function fetchFreeToolModels(
  fetchFn: FetchLike = globalThis.fetch,
): Promise<ModelChoice[]> {
  const models = await fetchModels(fetchFn);
  return models
    .filter((m) => isUsable(m) && supportsTools(m))
    .map((m) => toChoice(m, false));
}

/**
 * Free models usable for observation. Observation prompts are text-only
 * (semantic snapshots, no images), so every usable model qualifies;
 * tools-capable ones are flagged recommended — pick one of those and the
 * chat slot can share it.
 */
export async function fetchFreeObserveModels(
  fetchFn: FetchLike = globalThis.fetch,
): Promise<ModelChoice[]> {
  const models = await fetchModels(fetchFn);
  return models.filter(isUsable).map((m) => toChoice(m, supportsTools(m)));
}
