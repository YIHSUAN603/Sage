// The standalone settings window: a sidebar of sections on the left, the
// active section's fields on the right, and a save/cancel footer. One draft
// lives here (sections receive draft + patch as props) and is written back in
// a single save — settings broadcasts reload every other window, so saving
// per-keystroke would thrash the observation loop and the theme.
//
// The webview boots hidden with the app and is only ever shown/hidden:
// SETTINGS_WINDOW_OPEN_EVENT (emitted by openSettingsWindow before show)
// resets the draft from the store and reloads the pickers.
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AboutSection } from "../components/settings/AboutSection.tsx";
import { CompanionSection } from "../components/settings/CompanionSection.tsx";
import { GeneralSection } from "../components/settings/GeneralSection.tsx";
import { MemorySection } from "../components/settings/MemorySection.tsx";
import { ModelSection } from "../components/settings/ModelSection.tsx";
import { PrivacySection } from "../components/settings/PrivacySection.tsx";
import {
  parseCooldown,
  parseMaxPerHour,
  sortRecommendedFirst,
  type ModelOption,
  type PetSageDraft,
} from "../components/settings/settingsForm.ts";
import { ProactiveSection } from "../components/settings/ProactiveSection.tsx";
import { SETTINGS_WINDOW_OPEN_EVENT } from "../events.ts";
import type { PetMeta, Settings } from "../ipc/contract.ts";
import { fetchFreeObserveModels, fetchFreeToolModels } from "../llm/models.ts";
import { hasTauri } from "../runtime.ts";
import { requireIpc } from "../store/ipc.ts";
import { useSettingsStore } from "../store/settings.ts";
import "./settings.css";

const SECTIONS = [
  "general",
  "companion",
  "model",
  "proactive",
  "privacy",
  "memory",
  "about",
] as const;
type SectionId = (typeof SECTIONS)[number];

async function hideWindow(): Promise<void> {
  if (!hasTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

export function SettingsWindow() {
  const { t, i18n } = useTranslation();
  const loaded = useSettingsStore((s) => s.loaded);
  const save = useSettingsStore((s) => s.save);
  const saving = useSettingsStore((s) => s.saving);
  const error = useSettingsStore((s) => s.error);

  const [active, setActive] = useState<SectionId>("general");
  // Bumped on every open event; keys the content so sections remount fresh.
  const [epoch, setEpoch] = useState(0);
  const [draft, setDraft] = useState<Settings>(
    () => useSettingsStore.getState().settings,
  );
  const [blocklistText, setBlocklistText] = useState("");
  const [chatModels, setChatModels] = useState<ModelOption[]>([]);
  const [observeModels, setObserveModels] = useState<ModelOption[]>([]);
  const [modelsError, setModelsError] = useState(false);
  const [pets, setPets] = useState<PetMeta[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(false);
  const [petSage, setPetSage] = useState<PetSageDraft | null>(null);
  const [petSageError, setPetSageError] = useState(false);

  const patch = (p: Partial<Settings>) => setDraft((d) => ({ ...d, ...p }));

  // The native close button must hide, not destroy — a destroyed window can
  // never be fetched by label again for the rest of the app's life.
  useEffect(() => {
    if (!hasTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const off = await getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault();
        void getCurrentWindow().hide();
      });
      if (disposed) off();
      else unlisten = off;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Every open (from chat ⚙ / composer guide) resets the draft + pickers.
  useEffect(() => {
    if (!hasTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen(SETTINGS_WINDOW_OPEN_EVENT, () => {
        setEpoch((n) => n + 1);
      });
      if (disposed) off();
      else unlisten = off;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Keep the native title in the UI language.
  useEffect(() => {
    if (!hasTauri()) return;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setTitle(t("settings.title"));
    })();
  }, [t, i18n.language]);

  // Reset the draft and reload pickers on every open (and once the store's
  // initial load lands). At boot (epoch 0) the hidden webview skips the
  // network/scan work — the first open event triggers it.
  useEffect(() => {
    const current = useSettingsStore.getState().settings;
    setDraft(current);
    setBlocklistText(current.observe_blocklist.join("\n"));
    setPetSageError(false);
    setImportError(false);
    let cancelled = false;
    void (async () => {
      if (hasTauri() && epoch === 0) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (!(await getCurrentWindow().isVisible())) return;
      }
      setModelsError(false);
      fetchFreeToolModels()
        .then((models) => !cancelled && setChatModels(sortRecommendedFirst(models)))
        .catch(() => !cancelled && setModelsError(true));
      fetchFreeObserveModels()
        .then((models) => !cancelled && setObserveModels(sortRecommendedFirst(models)))
        .catch(() => {});
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
  }, [epoch, loaded]);

  // Load the selected pet's sage block so its persona/cadence can be edited.
  // An unreadable pet hides the editor (nothing sensible to write back to).
  useEffect(() => {
    setPetSageError(false);
    const id = draft.active_pet.trim();
    if (!id) {
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
  }, [epoch, draft.active_pet]);

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
    // write them back first; on failure keep the window open with the error.
    if (petSage?.dirty && draft.active_pet.trim() === petSage.id) {
      setPetSageError(false);
      try {
        await requireIpc().updatePetSage(petSage.id, petSage.persona, {
          cooldownMinutes: parseCooldown(petSage.cooldown),
          maxPerHour: parseMaxPerHour(petSage.maxPerHour),
        });
      } catch {
        setPetSageError(true);
        setActive("companion");
        return;
      }
    }
    await save(draft);
    if (!useSettingsStore.getState().error) void hideWindow();
  };

  return (
    <form className="settings-stage" onSubmit={submit}>
      <nav className="settings-nav" aria-label={t("settings.title")}>
        {SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            className={active === id ? "active" : ""}
            onClick={() => setActive(id)}
          >
            {t(`settings.nav.${id}`)}
          </button>
        ))}
      </nav>
      <div className="settings-main">
        <div className="settings-content" key={epoch}>
          {active === "general" && <GeneralSection draft={draft} patch={patch} />}
          {active === "companion" && (
            <CompanionSection
              draft={draft}
              patch={patch}
              pets={pets}
              importing={importing}
              importError={importError}
              onImportPet={() => void importPet()}
              petSage={petSage}
              setPetSage={setPetSage}
              petSageError={petSageError}
            />
          )}
          {active === "model" && (
            <ModelSection
              draft={draft}
              patch={patch}
              chatModels={chatModels}
              observeModels={observeModels}
              modelsError={modelsError}
            />
          )}
          {active === "proactive" && (
            <ProactiveSection
              draft={draft}
              patch={patch}
              petSage={petSage}
              setPetSage={setPetSage}
            />
          )}
          {active === "privacy" && (
            <PrivacySection
              draft={draft}
              patch={patch}
              blocklistText={blocklistText}
              setBlocklistText={setBlocklistText}
            />
          )}
          {active === "memory" && <MemorySection draft={draft} patch={patch} />}
          {active === "about" && <AboutSection />}
        </div>
        {error && <p className="settings-error">{error}</p>}
        <div className="settings-actions">
          <button type="button" onClick={() => void hideWindow()}>
            {t("settings.cancel")}
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? t("settings.saving") : t("settings.save")}
          </button>
        </div>
      </div>
    </form>
  );
}
