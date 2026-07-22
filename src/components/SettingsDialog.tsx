// S4.4 — Settings modal inside the chat window: API key, the two model
// slots (chat needs `tools`, observe needs image input), and the
// observation switch with its privacy note.
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_LABELS, LANGUAGES } from "../i18n/index.ts";
import type { PetMeta, Settings } from "../ipc/contract.ts";
import { requireIpc } from "../store/ipc.ts";
import { useSettingsStore } from "../store/settings.ts";
import {
  AGENT_PERMISSIONS,
  normalizePermission,
  PERMISSION_HINT_KEY,
  PERMISSION_LABEL_KEY,
} from "./agentPermission.ts";
import { UpdateSection } from "./UpdateSection.tsx";

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

/** Sentinel select value that reveals the free-text model input. */
const CUSTOM_MODEL = "__custom__";

/**
 * The selected pet's editable `sage` block, loaded from its pet.json.
 * Numeric fields stay strings so "" can mean "inherit the global setting".
 */
interface PetSageDraft {
  id: string;
  displayName: string;
  persona: string;
  cooldown: string;
  maxPerHour: string;
  dirty: boolean;
}

/** "" or invalid ⇒ undefined (inherit); otherwise the parsed minutes (> 0). */
function parseCooldown(raw: string): number | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** One blocklist entry per line; blanks dropped, whitespace trimmed. */
function parseBlocklist(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** "" or invalid ⇒ undefined (inherit); 0 is kept — it means explicitly unlimited. */
function parseMaxPerHour(raw: string): number | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Math.floor(Number(t));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// Neither CLI can enumerate available models, so these are curated aliases (they
// map to `--model`). Codex has no stable alias set — users type theirs (Custom…).
const AGENT_MODEL_PRESETS: Record<Settings["agent_cli"], { value: string; label: string }[]> = {
  claude: [
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
    { value: "haiku", label: "Haiku" },
    { value: "fable", label: "Fable" },
  ],
  codex: [],
};

/** Is `model` representable by the CLI's dropdown (empty = default, or a preset)? */
function isModelPreset(cli: Settings["agent_cli"], model: string): boolean {
  return model === "" || AGENT_MODEL_PRESETS[cli].some((p) => p.value === model);
}

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
  const [petSage, setPetSage] = useState<PetSageDraft | null>(null);
  const [petSageError, setPetSageError] = useState(false);
  const [cliCheck, setCliCheck] = useState<{
    status: "checking" | "ok" | "missing";
    text: string;
  } | null>(null);
  // Whether the model dropdown is in "Custom…" mode (free-text id, not a preset).
  const [customModel, setCustomModel] = useState(false);
  // Raw textarea text for observe_blocklist (one entry per line); parsed into
  // the draft on every change so typing (blank lines, spaces) isn't disturbed.
  const [blocklistText, setBlocklistText] = useState("");

  useEffect(() => {
    if (!open) return;
    const current = useSettingsStore.getState().settings;
    setDraft(current);
    setBlocklistText(current.observe_blocklist.join("\n"));
    setCustomModel(!isModelPreset(current.agent_cli, current.agent_cli_model));
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

  // Load the selected pet's sage block so its persona/cadence can be edited.
  // An unreadable pet hides the editor (nothing sensible to write back to).
  useEffect(() => {
    setPetSageError(false);
    const id = draft.active_pet.trim();
    if (!open || !id) {
      setPetSage(null);
      return;
    }
    let cancelled = false;
    requireIpc()
      .readPet(id)
      .then((pet) => {
        if (cancelled) return;
        setPetSage({
          id,
          displayName: pet.displayName,
          persona: pet.persona ?? "",
          cooldown: pet.proactive?.cooldownMinutes?.toString() ?? "",
          maxPerHour: pet.proactive?.maxPerHour?.toString() ?? "",
          dirty: false,
        });
      })
      .catch(() => !cancelled && setPetSage(null));
    return () => {
      cancelled = true;
    };
  }, [open, draft.active_pet]);

  // Probe the selected agent CLI (debounced) so a missing binary shows up here
  // rather than as a cryptic error on the first message.
  useEffect(() => {
    if (!open || draft.backend !== "agent_cli") {
      setCliCheck(null);
      return;
    }
    let cancelled = false;
    setCliCheck({ status: "checking", text: t("settings.agentCliChecking") });
    const handle = setTimeout(() => {
      requireIpc()
        .checkAgentCli(draft.agent_cli, draft.agent_cli_path.trim())
        .then(
          (version) =>
            !cancelled &&
            setCliCheck({ status: "ok", text: t("settings.agentCliDetected", { version }) }),
        )
        .catch(
          () => !cancelled && setCliCheck({ status: "missing", text: t("settings.agentCliMissing") }),
        );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, draft.backend, draft.agent_cli, draft.agent_cli_path, t]);

  if (!open) return null;

  const useAgentCli = draft.backend === "agent_cli";
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
    // Persona/cadence edits for a pet live in its pet.json, not in settings —
    // write them back first; on failure keep the dialog open with the error.
    if (petSage?.dirty && draft.active_pet.trim() === petSage.id) {
      setPetSageError(false);
      try {
        await requireIpc().updatePetSage(petSage.id, petSage.persona, {
          cooldownMinutes: parseCooldown(petSage.cooldown),
          maxPerHour: parseMaxPerHour(petSage.maxPerHour),
        });
      } catch {
        setPetSageError(true);
        return;
      }
    }
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

        {draft.active_pet.trim() === "" ? (
          <>
            <label className="field">
              <span>{t("settings.persona")}</span>
              <textarea
                rows={3}
                value={draft.custom_persona}
                placeholder={t("persona.default", { ns: "prompt" })}
                onChange={(e) => patch({ custom_persona: e.currentTarget.value })}
              />
              <span className="field-hint">{t("settings.personaBuiltinHint")}</span>
            </label>
            <div className="field">
              <div className="field field-row">
                <label className="interval-label">
                  <span>{t("settings.proactiveCooldown")}</span>
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={draft.proactive_cooldown_minutes}
                    onChange={(e) =>
                      patch({
                        proactive_cooldown_minutes: Math.max(
                          0.5,
                          Number(e.currentTarget.value) || 0,
                        ),
                      })
                    }
                  />
                </label>
                <label className="interval-label">
                  <span>{t("settings.proactiveMaxPerHour")}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={draft.proactive_max_per_hour}
                    onChange={(e) =>
                      patch({
                        proactive_max_per_hour: Math.max(
                          0,
                          Math.floor(Number(e.currentTarget.value) || 0),
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <span className="field-hint">{t("settings.proactiveBuiltinHint")}</span>
            </div>
          </>
        ) : (
          petSage && (
            <>
              <label className="field">
                <span>{t("settings.persona")}</span>
                <textarea
                  rows={3}
                  value={petSage.persona}
                  placeholder={t("persona.synthBase", {
                    ns: "prompt",
                    name: petSage.displayName,
                  })}
                  onChange={(e) =>
                    setPetSage({ ...petSage, persona: e.currentTarget.value, dirty: true })
                  }
                />
                <span className="field-hint">{t("settings.personaPetHint")}</span>
              </label>
              <div className="field">
                <div className="field field-row">
                  <label className="interval-label">
                    <span>{t("settings.proactiveCooldown")}</span>
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={petSage.cooldown}
                      placeholder={String(draft.proactive_cooldown_minutes)}
                      onChange={(e) =>
                        setPetSage({ ...petSage, cooldown: e.currentTarget.value, dirty: true })
                      }
                    />
                  </label>
                  <label className="interval-label">
                    <span>{t("settings.proactiveMaxPerHour")}</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={petSage.maxPerHour}
                      placeholder={
                        draft.proactive_max_per_hour === 0
                          ? t("settings.proactiveUnlimited")
                          : String(draft.proactive_max_per_hour)
                      }
                      onChange={(e) =>
                        setPetSage({
                          ...petSage,
                          maxPerHour: e.currentTarget.value,
                          dirty: true,
                        })
                      }
                    />
                  </label>
                </div>
                <span className="field-hint">
                  {t("settings.proactivePetHint", {
                    cooldown: draft.proactive_cooldown_minutes,
                    max:
                      draft.proactive_max_per_hour === 0
                        ? t("settings.proactiveUnlimited")
                        : draft.proactive_max_per_hour,
                  })}
                </span>
                {petSageError && (
                  <span className="field-hint field-hint-error">
                    {t("settings.petSageError")}
                  </span>
                )}
              </div>
            </>
          )
        )}

        <label className="field">
          <span>{t("settings.backend")}</span>
          <select
            value={draft.backend}
            onChange={(e) =>
              patch({ backend: e.currentTarget.value as Settings["backend"] })
            }
          >
            <option value="openrouter">{t("settings.backendOpenRouter")}</option>
            <option value="agent_cli">{t("settings.backendAgentCli")}</option>
          </select>
        </label>

        {useAgentCli && (
          <>
            <label className="field">
              <span>{t("settings.agentCli")}</span>
              <select
                value={draft.agent_cli}
                onChange={(e) => {
                  const cli = e.currentTarget.value as Settings["agent_cli"];
                  patch({ agent_cli: cli });
                  // A model set for the old CLI may not be a preset of the new one.
                  setCustomModel(!isModelPreset(cli, draft.agent_cli_model));
                }}
              >
                <option value="claude">Claude Code</option>
                <option value="codex">Codex</option>
              </select>
              <input
                type="text"
                value={draft.agent_cli_path}
                placeholder={t("settings.agentCliPathPlaceholder")}
                autoComplete="off"
                onChange={(e) => patch({ agent_cli_path: e.currentTarget.value })}
              />
              {cliCheck && (
                <span
                  className={`field-hint${cliCheck.status === "missing" ? " field-hint-error" : ""}`}
                >
                  {cliCheck.text}
                </span>
              )}
              {draft.agent_cli === "codex" && (
                <span className="field-hint">{t("settings.agentCliCodexObserve")}</span>
              )}
            </label>

            <label className="field">
              <span>{t("settings.agentCliModel")}</span>
              <select
                value={customModel ? CUSTOM_MODEL : draft.agent_cli_model}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  if (v === CUSTOM_MODEL) {
                    setCustomModel(true);
                  } else {
                    setCustomModel(false);
                    patch({ agent_cli_model: v });
                  }
                }}
              >
                <option value="">{t("settings.agentCliModelDefault")}</option>
                {AGENT_MODEL_PRESETS[draft.agent_cli].map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
                <option value={CUSTOM_MODEL}>{t("settings.agentCliModelCustom")}</option>
              </select>
              {customModel && (
                <input
                  type="text"
                  value={draft.agent_cli_model}
                  placeholder={t("settings.agentCliModelPlaceholder")}
                  autoComplete="off"
                  onChange={(e) => patch({ agent_cli_model: e.currentTarget.value })}
                />
              )}
            </label>

            <label className="field">
              <span>{t("settings.agentCliPermission")}</span>
              <select
                value={normalizePermission(draft.agent_cli_permission)}
                onChange={(e) =>
                  patch({
                    agent_cli_permission: e.currentTarget
                      .value as Settings["agent_cli_permission"],
                  })
                }
              >
                {AGENT_PERMISSIONS.map((p) => (
                  <option key={p} value={p}>
                    {t(PERMISSION_LABEL_KEY[p])}
                  </option>
                ))}
              </select>
              <span
                className={`field-hint${
                  normalizePermission(draft.agent_cli_permission) === "full"
                    ? " field-hint-error"
                    : ""
                }`}
              >
                {t(PERMISSION_HINT_KEY[normalizePermission(draft.agent_cli_permission)])}
              </span>
            </label>
          </>
        )}

        {!useAgentCli && (
          <>
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
          </>
        )}

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

        <div className="field">
          <label className="switch-label">
            <input
              type="checkbox"
              checked={draft.idle_chatter_enabled}
              onChange={(e) =>
                patch({ idle_chatter_enabled: e.currentTarget.checked })
              }
            />
            <span>{t("settings.idleChatter")}</span>
          </label>
          <span className="field-hint">{t("settings.idleChatterHint")}</span>
        </div>

        <label className="field">
          <span>{t("settings.captureMode")}</span>
          <select
            value={draft.observe_capture_mode}
            disabled={!draft.observe_enabled}
            onChange={(e) =>
              patch({
                observe_capture_mode: e.currentTarget
                  .value as Settings["observe_capture_mode"],
              })
            }
          >
            <option value="window">{t("settings.captureModeWindow")}</option>
            <option value="screen">{t("settings.captureModeScreen")}</option>
          </select>
        </label>

        {!useAgentCli && (
          <div className="field">
            <label className="switch-label">
              <input
                type="checkbox"
                checked={draft.observe_deny_data_collection}
                disabled={!draft.observe_enabled}
                onChange={(e) =>
                  patch({ observe_deny_data_collection: e.currentTarget.checked })
                }
              />
              <span>{t("settings.denyDataCollection")}</span>
            </label>
            <span className="field-hint">{t("settings.denyDataCollectionHint")}</span>
          </div>
        )}

        <label className="field">
          <span>{t("settings.blocklist")}</span>
          <textarea
            rows={3}
            value={blocklistText}
            disabled={!draft.observe_enabled}
            placeholder={t("settings.blocklistPlaceholder")}
            onChange={(e) => {
              setBlocklistText(e.currentTarget.value);
              patch({ observe_blocklist: parseBlocklist(e.currentTarget.value) });
            }}
          />
          <span className="field-hint">{t("settings.blocklistHint")}</span>
        </label>

        <UpdateSection />

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
