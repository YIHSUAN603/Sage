import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchFreeObserveModels,
  fetchFreeToolModels,
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
  {
    id: "g/content-safety:free",
    name: "Vendor: Content Safety (free)",
    pricing: { prompt: "0" },
    supported_parameters: ["tools"],
    architecture: { input_modalities: ["text", "image"] },
  },
  {
    id: "h/free-music",
    name: "Free Music Preview",
    pricing: { prompt: "0" },
    supported_parameters: ["tools"],
    architecture: {
      input_modalities: ["text", "image"],
      output_modalities: ["audio"],
    },
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
    { id: "c/free-both", name: "Free Both", recommended: false },
  ]);
});

test("fetchFreeObserveModels keeps every usable free model, flagging tools-capable as shareable", async () => {
  // 觀察是純文字 prompt——不再要求 image 輸入，任何可用的免費模型都合格；
  // 支援 tools 的標記為推薦（同一顆可與聊天槽共用）。
  const models = await fetchFreeObserveModels(fakeFetch({ data: CATALOG }));
  assert.deepEqual(models, [
    { id: "a/free-tools", name: "Free Tools", recommended: true },
    { id: "b/free-vision", name: "Free Vision", recommended: false },
    { id: "c/free-both", name: "Free Both", recommended: true },
    { id: "e/free-plain", name: "Free Plain", recommended: false },
  ]);
});

test("models missing pricing/capability fields are treated as not matching", async () => {
  const tools = await fetchFreeToolModels(fakeFetch({ data: CATALOG }));
  const observe = await fetchFreeObserveModels(fakeFetch({ data: CATALOG }));
  // e/free-plain 沒有 pricing 以外的能力欄位：聊天槽要求 tools 所以出局，
  // 觀察槽只要可用即可（免費、輸出文字、非分類器）所以保留。
  assert.ok(!tools.some((m) => m.id === "e/free-plain"));
  assert.ok(observe.some((m) => m.id === "e/free-plain"));
  for (const list of [tools, observe]) {
    assert.ok(!list.some((m) => m.id === "d/paid-both"));
    // prompt 免費但 completion 計費 → 不是真免費
    assert.ok(!list.some((m) => m.id === "f/free-prompt-paid-completion"));
  }
});

test("safety classifiers and non-text-output models are excluded", async () => {
  const tools = await fetchFreeToolModels(fakeFetch({ data: CATALOG }));
  const observe = await fetchFreeObserveModels(fakeFetch({ data: CATALOG }));
  for (const list of [tools, observe]) {
    // 只回 safe/unsafe 標籤的審查模型（如 content-safety、llama-guard）
    assert.ok(!list.some((m) => m.id === "g/content-safety:free"));
    // 輸出不含 text 的模型（音樂/影像生成）
    assert.ok(!list.some((m) => m.id === "h/free-music"));
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
    () => fetchFreeObserveModels(fakeFetch({ data: "nope" })),
    /missing data array/,
  );
});
