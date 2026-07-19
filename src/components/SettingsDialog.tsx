// S4.4 — Settings modal inside the chat window: API key, the two model
// slots (chat needs `tools`, observe needs image input), and the
// observation switch with its privacy note.
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_LABELS, LANGUAGES } from "../i18n/index.ts";
import type { Settings } from "../ipc/contract.ts";
import { useSettingsStore } from "../store/settings.ts";

/**
 * 模型清單載入介面（llm/models.ts 的 fetchFreeToolModels /
 * fetchFreeVisionModels）。載入失敗或回空陣列時，欄位退化成
 * 「手填 model id 的 text input + datalist」。
 */
export interface ModelOption {
  id: string;
  name: string;
  recommended?: boolean;
}
export type LoadModels = () => Promise<ModelOption[]>;

const loadModelsPlaceholder: LoadModels = async () => [];

function sortRecommendedFirst(models: ModelOption[]): ModelOption[] {
  return [...models].sort(
    (a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false),
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 免費且支援 tools 的模型清單。 */
  loadChatModels?: LoadModels;
  /** 免費且支援 image 輸入的模型清單。 */
  loadObserveModels?: LoadModels;
}

export function SettingsDialog({
  open,
  onClose,
  loadChatModels = loadModelsPlaceholder,
  loadObserveModels = loadModelsPlaceholder,
}: Props) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const save = useSettingsStore((s) => s.save);
  const saving = useSettingsStore((s) => s.saving);
  const error = useSettingsStore((s) => s.error);

  const [draft, setDraft] = useState<Settings>(settings);
  const [chatModels, setChatModels] = useState<ModelOption[]>([]);
  const [observeModels, setObserveModels] = useState<ModelOption[]>([]);
  const [modelsError, setModelsError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(useSettingsStore.getState().settings);
    setModelsError(false);
    let cancelled = false;
    loadChatModels()
      .then((models) => !cancelled && setChatModels(sortRecommendedFirst(models)))
      .catch(() => !cancelled && setModelsError(true));
    loadObserveModels()
      .then((models) => !cancelled && setObserveModels(sortRecommendedFirst(models)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, loadChatModels, loadObserveModels]);

  if (!open) return null;

  const patch = (p: Partial<Settings>) => setDraft((d) => ({ ...d, ...p }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await save(draft);
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2>{t("settings.title")}</h2>

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

        <label className="field">
          <span>OpenRouter API key</span>
          <input
            type="password"
            value={draft.api_key}
            placeholder="sk-or-…"
            autoComplete="off"
            onChange={(e) => patch({ api_key: e.currentTarget.value })}
          />
        </label>

        <label className="field">
          <span>{t("settings.chatModel")}</span>
          <input
            type="text"
            list="chat-model-options"
            value={draft.chat_model}
            placeholder={t("settings.chatModelPlaceholder")}
            onChange={(e) => patch({ chat_model: e.currentTarget.value })}
          />
          {modelsError && (
            <span className="field-hint">{t("settings.modelsError")}</span>
          )}
          <datalist id="chat-model-options">
            {chatModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name + (m.recommended ? t("settings.recommended") : "")}
              </option>
            ))}
          </datalist>
        </label>

        <label className="field">
          <span>{t("settings.observeModel")}</span>
          <input
            type="text"
            list="observe-model-options"
            value={draft.observe_model}
            placeholder={t("settings.observeModelPlaceholder")}
            onChange={(e) => patch({ observe_model: e.currentTarget.value })}
          />
          <datalist id="observe-model-options">
            {observeModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name + (m.recommended ? t("settings.recommended") : "")}
              </option>
            ))}
          </datalist>
        </label>

        <div className="field field-row">
          <label className="switch-label">
            <input
              type="checkbox"
              checked={draft.observe_enabled}
              onChange={(e) =>
                patch({ observe_enabled: e.currentTarget.checked })
              }
            />
            <span>{t("settings.observeEnable")}</span>
          </label>
          <label className="interval-label">
            <span>{t("settings.interval")}</span>
            <input
              type="number"
              min={2}
              max={600}
              value={draft.observe_interval}
              disabled={!draft.observe_enabled}
              onChange={(e) =>
                patch({
                  observe_interval: Math.max(
                    2,
                    Math.floor(Number(e.currentTarget.value) || 0),
                  ),
                })
              }
            />
            <span>{t("settings.seconds")}</span>
          </label>
        </div>

        <p className="privacy-note">{t("settings.privacyNote")}</p>

        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t("settings.cancel")}
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? t("settings.saving") : t("settings.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
