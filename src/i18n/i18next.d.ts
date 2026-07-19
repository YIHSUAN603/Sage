// Typed translation keys: t("composer.noKey") autocompletes and a typo'd key
// is a compile error. zh-TW is the source of truth for the key shape.
import type zhTW from "./locales/zh-TW.ts";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "ui";
    resources: typeof zhTW;
  }
}
