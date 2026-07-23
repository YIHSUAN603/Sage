// One model slot (chat / observe) for the OpenRouter backend.
import { useTranslation } from "react-i18next";
import type { ModelOption } from "./settingsForm.ts";

interface Props {
  label: string;
  value: string;
  placeholder: string;
  models: ModelOption[];
  /** 載入失敗時的提示；只有 chat 欄位會傳。 */
  errorText?: string;
  onChange: (id: string) => void;
}

/**
 * 有清單就用真正的 <select>——它永遠顯示全部選項。舊做法用 <input list>
 * ＋<datalist>，瀏覽器會拿目前輸入值去過濾 datalist，一旦存過 model id，
 * 再開下拉就只剩「符合該 id」的那一項（也就是已選的自己）。
 * 清單為空（載入失敗）時退化成純文字輸入，讓使用者手填 model id。
 */
export function ModelField({ label, value, placeholder, models, errorText, onChange }: Props) {
  const { t } = useTranslation();

  if (models.length === 0) {
    return (
      <label className="field">
        <span>{label}</span>
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
        {errorText && <span className="field-hint">{errorText}</span>}
      </label>
    );
  }

  // 已存的值可能不在清單裡（模型下架或先前手填），補一個 option 以免選取被清空。
  const known = models.some((m) => m.id === value);
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {!known && <option value={value}>{value || placeholder}</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name + (m.recommended ? t("settings.recommended") : "")}
          </option>
        ))}
      </select>
    </label>
  );
}
