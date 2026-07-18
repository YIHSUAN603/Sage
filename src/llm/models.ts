// S2.2 — Fetch the OpenRouter model list and filter by capability.
// `fetchFn` is injectable so tests never hit the network.

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Raw shape of one entry in OpenRouter's GET /api/v1/models response. */
export interface OpenRouterModel {
  id: string;
  name: string;
  /** Prices are strings; "0" means free. */
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
}

/** A model that passed a capability filter, ready for a settings dropdown. */
export interface ModelChoice {
  id: string;
  name: string;
  /** True when the model is free AND supports both tools and image input. */
  recommended: boolean;
}

/** Minimal fetch surface — `globalThis.fetch` satisfies it. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

function isFree(model: OpenRouterModel): boolean {
  return model.pricing?.prompt === "0";
}

function supportsTools(model: OpenRouterModel): boolean {
  return (model.supported_parameters ?? []).includes("tools");
}

function supportsImageInput(model: OpenRouterModel): boolean {
  return (model.architecture?.input_modalities ?? []).includes("image");
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

function toChoice(model: OpenRouterModel): ModelChoice {
  return {
    id: model.id,
    name: model.name,
    recommended: supportsTools(model) && supportsImageInput(model),
  };
}

/** Free models usable for chat + function calling (`tools`). */
export async function fetchFreeToolModels(
  fetchFn: FetchLike = globalThis.fetch,
): Promise<ModelChoice[]> {
  const models = await fetchModels(fetchFn);
  return models.filter((m) => isFree(m) && supportsTools(m)).map(toChoice);
}

/** Free models usable for screen observation (accept image input). */
export async function fetchFreeVisionModels(
  fetchFn: FetchLike = globalThis.fetch,
): Promise<ModelChoice[]> {
  const models = await fetchModels(fetchFn);
  return models.filter((m) => isFree(m) && supportsImageInput(m)).map(toChoice);
}
