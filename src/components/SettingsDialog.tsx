// S4.4 — Settings modal inside the chat window: API key, the two model
// slots (chat needs `tools`, observe needs image input), and the
// observation switch with its privacy note.
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_LABELS, LANGUAGES } from "../i18n/index.ts";
import type { PetMeta, Settings } from "../ipc/contract.ts";
import { requireIpc } from "../store/ipc.ts";
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

interface ModelFieldProps {
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
function ModelField({ label, value, placeholder, models, errorText, onChange }: ModelFieldProps) {
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
  const [pets, setPets] = useState<PetMeta[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(false);

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
    void (async () => {
      try {
        const list = await requireIpc().listPets();
        if (!cancelled) setPets(list);
      } catch {
        // No pets picker data (ipc unbound / scan failed) — keep built-in only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loadChatModels, loadObserveModels]);

  if (!open) return null;

  const patch = (p: Partial<Settings>) => setDraft((d) => ({ ...d, ...p }));

  // Pick a pet folder, copy it into <config>/pets/, then select it. The
  // avatar swaps once the draft is saved (settings broadcast reloads it).
  const importPet = async () => {
    setImportError(false);
    setImporting(true);
    try {
      const imported = await requireIpc().importPet();
      if (!imported) return; // user cancelled the picker
      const list = await requireIpc().listPets();
      setPets(list);
      patch({ active_pet: imported.id });
    } catch {
      setImportError(true);
    } finally {
      setImporting(false);
    }
  };

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
          <span>{t("settings.companion")}</span>
          <select
            value={draft.active_pet}
            onChange={(e) => patch({ active_pet: e.currentTarget.value })}
          >
            <option value="">{t("settings.companionBuiltin")}</option>
            {draft.active_pet &&
              !pets.some((p) => p.id === draft.active_pet) && (
                <option value={draft.active_pet}>{draft.active_pet}</option>
              )}
            {pets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="import-pet"
            disabled={importing}
            onClick={importPet}
          >
            {importing ? t("settings.importing") : t("settings.importPet")}
          </button>
          {importError && (
            <span className="field-hint">{t("settings.importError")}</span>
          )}
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

        <ModelField
          label={t("settings.chatModel")}
          value={draft.chat_model}
          placeholder={t("settings.chatModelPlaceholder")}
          models={chatModels}
          errorText={modelsError ? t("settings.modelsError") : undefined}
          onChange={(id) => patch({ chat_model: id })}
        />

        <ModelField
          label={t("settings.observeModel")}
          value={draft.observe_model}
          placeholder={t("settings.observeModelPlaceholder")}
          models={observeModels}
          onChange={(id) => patch({ observe_model: id })}
        />

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
