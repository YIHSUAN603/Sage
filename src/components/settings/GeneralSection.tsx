// Settings › General: UI + assistant language.
import { useTranslation } from "react-i18next";
import { LANGUAGE_LABELS, LANGUAGES } from "../../i18n/index.ts";
import type { Settings } from "../../ipc/contract.ts";
import type { PatchSettings } from "./settingsForm.ts";

interface Props {
  draft: Settings;
  patch: PatchSettings;
}

export function GeneralSection({ draft, patch }: Props) {
  const { t } = useTranslation();
  return (
    <label className="field">
      <span>{t("settings.language")}</span>
      <select
        value={draft.language}
        onChange={(e) => patch({ language: e.currentTarget.value })}
      >
        <option value="auto">{t("settings.languageAuto")}</option>
        {LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {LANGUAGE_LABELS[lang]}
          </option>
        ))}
      </select>
    </label>
  );
}
