import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchFreeToolModels,
  fetchFreeVisionModels,
  OPENROUTER_MODELS_URL,
  type FetchLike,
  type OpenRouterModel,
} from "../src/llm/models.ts";

const CATALOG: OpenRouterModel[] = [
  {
    id: "a/free-tools",
    name: "Free Tools",
    pricing: { prompt: "0" },
    supported_parameters: ["tools", "temperature"],
    architecture: { input_modalities: ["text"] },
  },
  {
    id: "b/free-vision",
    name: "Free Vision",
    pricing: { prompt: "0" },
    supported_parameters: ["temperature"],
    architecture: { input_modalities: ["text", "image"] },
  },
  {
    id: "c/free-both",
    name: "Free Both",
    pricing: { prompt: "0" },
    supported_parameters: ["tools"],
    architecture: { input_modalities: ["text", "image"] },
  },
  {
    id: "d/paid-both",
    name: "Paid Both",
    pricing: { prompt: "0.000002" },
    supported_parameters: ["tools"],
    architecture: { input_modalities: ["text", "image"] },
  },
  {
    id: "e/free-plain",
    name: "Free Plain",
    pricing: { prompt: "0" },
  },
  {
    id: "f/free-prompt-paid-completion",
    name: "Free Prompt Paid Completion",
    pricing: { prompt: "0", completion: "0.000001" },
    supported_parameters: ["tools"],
    architecture: { input_modalities: ["text", "image"] },
  },
];

function fakeFetch(
  body: unknown,
  opts: { ok?: boolean; status?: number; urls?: string[] } = {},
): FetchLike {
  return async (url) => {
    opts.urls?.push(url);
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => body,
    };
  };
}

test("fetchFreeToolModels keeps only free models supporting tools", async () => {
  const urls: string[] = [];
  const models = await fetchFreeToolModels(fakeFetch({ data: CATALOG }, { urls }));
  assert.deepEqual(urls, [OPENROUTER_MODELS_URL]);
  assert.deepEqual(models, [
    { id: "a/free-tools", name: "Free Tools", recommended: false },
    { id: "c/free-both", name: "Free Both", recommended: true },
  ]);
});

test("fetchFreeVisionModels keeps only free models with image input", async () => {
  const models = await fetchFreeVisionModels(fakeFetch({ data: CATALOG }));
  assert.deepEqual(models, [
    { id: "b/free-vision", name: "Free Vision", recommended: false },
    { id: "c/free-both", name: "Free Both", recommended: true },
  ]);
});

test("models missing pricing/capability fields are treated as not matching", async () => {
  const tools = await fetchFreeToolModels(fakeFetch({ data: CATALOG }));
  const vision = await fetchFreeVisionModels(fakeFetch({ data: CATALOG }));
  for (const list of [tools, vision]) {
    assert.ok(!list.some((m) => m.id === "e/free-plain"));
    assert.ok(!list.some((m) => m.id === "d/paid-both"));
    // prompt 免費但 completion 計費 → 不是真免費
    assert.ok(!list.some((m) => m.id === "f/free-prompt-paid-completion"));
  }
});

test("non-ok HTTP response rejects with the status code", async () => {
  await assert.rejects(
    () => fetchFreeToolModels(fakeFetch({}, { ok: false, status: 429 })),
    /HTTP 429/,
  );
});

test("malformed body without a data array rejects", async () => {
  await assert.rejects(
    () => fetchFreeVisionModels(fakeFetch({ data: "nope" })),
    /missing data array/,
  );
});
