import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, resolveLanguage, resources } from "../src/i18n/index.ts";

test("resolveLanguage: auto follows the system locale", () => {
  assert.equal(resolveLanguage("auto", "zh-TW"), "zh-TW");
  assert.equal(resolveLanguage("auto", "zh-Hant-TW"), "zh-TW");
  assert.equal(resolveLanguage("auto", "zh-HK"), "zh-TW");
  assert.equal(resolveLanguage("auto", "zh-CN"), "zh-CN");
  assert.equal(resolveLanguage("auto", "zh"), "zh-CN");
  assert.equal(resolveLanguage("auto", "ja-JP"), "ja");
  assert.equal(resolveLanguage("auto", "en-US"), "en");
  assert.equal(resolveLanguage("auto", "de-DE"), "en");
});

test("resolveLanguage: a concrete setting wins over the system locale", () => {
  assert.equal(resolveLanguage("ja", "en-US"), "ja");
  assert.equal(resolveLanguage("zh-TW", "ja-JP"), "zh-TW");
});

test("resolveLanguage: unknown settings fall back to the system locale", () => {
  assert.equal(resolveLanguage("ko", "ja-JP"), "ja");
  assert.equal(resolveLanguage("", "de-DE"), "en");
});

/** Flatten nested translation objects into dotted key paths. */
function flatKeys(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    flatKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

test("every locale carries exactly the zh-TW key set", () => {
  const base = flatKeys(resources["zh-TW"]).sort();
  for (const lang of LANGUAGES) {
    assert.deepEqual(
      flatKeys(resources[lang]).sort(),
      base,
      `locale ${lang} keys diverge from zh-TW`,
    );
  }
});

test("interpolation placeholders match across locales", () => {
  const placeholders = (s: string) =>
    [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  const byKey = new Map<string, string[]>();
  for (const key of flatKeys(resources["zh-TW"])) {
    const value = key
      .split(".")
      .reduce<unknown>((n, part) => (n as Record<string, unknown>)[part], resources["zh-TW"]);
    byKey.set(key, placeholders(value as string));
  }
  for (const lang of LANGUAGES) {
    for (const key of flatKeys(resources[lang])) {
      const value = key
        .split(".")
        .reduce<unknown>((n, part) => (n as Record<string, unknown>)[part], resources[lang]);
      assert.deepEqual(
        placeholders(value as string),
        byKey.get(key),
        `${lang}:${key} placeholders diverge from zh-TW`,
      );
    }
  }
});
