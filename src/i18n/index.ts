// i18n bootstrap: configures the i18next singleton (UI strings + LLM prompt
// templates, all four locales bundled inline — tiny payload, no lazy loading).
// The persisted `settings.language` is either "auto" (follow the system) or a
// concrete tag; resolveLanguage() maps it to a supported locale and
// applyLanguage() pushes it into i18next (store/settings.ts calls it on every
// load/save, so all webviews stay in sync via the existing SETTINGS_EVENT).
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.ts";
import ja from "./locales/ja.ts";
import zhCN from "./locales/zh-CN.ts";
import zhTW from "./locales/zh-TW.ts";

export const LANGUAGES = ["zh-TW", "en", "zh-CN", "ja"] as const;
export type Lang = (typeof LANGUAGES)[number];

/** Dropdown labels: each language names itself (never translated). */
export const LANGUAGE_LABELS: Record<Lang, string> = {
  "zh-TW": "繁體中文",
  en: "English",
  "zh-CN": "简体中文",
  ja: "日本語",
};

export const resources = {
  "zh-TW": zhTW,
  en,
  "zh-CN": zhCN,
  ja,
} as const;

function fromSystemLocale(locale: string): Lang {
  const lower = locale.toLowerCase();
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("zh")) {
    // Traditional-script regions (TW/HK/MO) and explicit zh-Hant → zh-TW.
    return /hant|tw|hk|mo/.test(lower) ? "zh-TW" : "zh-CN";
  }
  return "en";
}

/**
 * Map the persisted language setting to a supported locale.
 * "auto" (or anything unknown) falls back to the system locale;
 * `systemLocale` is injectable for tests.
 */
export function resolveLanguage(
  setting: string,
  systemLocale = typeof navigator !== "undefined" ? navigator.language : "en",
): Lang {
  if ((LANGUAGES as readonly string[]).includes(setting)) return setting as Lang;
  return fromSystemLocale(systemLocale);
}

/** Switch i18next to the locale the setting resolves to (no-op when already there). */
export function applyLanguage(setting: string): void {
  const lang = resolveLanguage(setting);
  if (i18next.language !== lang) void i18next.changeLanguage(lang);
}

/** Resolves when i18next finished initializing (await in tests before asserting). */
export const i18nReady = i18next.use(initReactI18next).init({
  resources,
  lng: resolveLanguage("auto"),
  fallbackLng: "en",
  defaultNS: "ui",
  ns: ["ui", "prompt"],
  interpolation: { escapeValue: false }, // React escapes; prompts must stay raw
});

export default i18next;
