// Settings › Proactive: the proactive-bubble switch and its cadence. When a
// pet is active its pet.json overrides the global cadence (proactiveTuning),
// so the controls edit the pet's values (written back on submit) instead.
import { useTranslation } from "react-i18next";
import type { Settings } from "../../ipc/contract.ts";
import type { PatchSettings, PetSageDraft } from "./settingsForm.ts";

interface Props {
  draft: Settings;
  patch: PatchSettings;
  petSage: PetSageDraft | null;
  setPetSage: (next: PetSageDraft) => void;
}

export function ProactiveSection({ draft, patch, petSage, setPetSage }: Props) {
  const { t } = useTranslation();
  const petCadence =
    petSage && petSage.id === draft.active_pet.trim() ? petSage : null;

  return (
    <div className="field">
      <div className="field field-row">
        <label className="switch-label">
          <input
            type="checkbox"
            checked={draft.proactive_enabled}
            onChange={(e) => patch({ proactive_enabled: e.currentTarget.checked })}
          />
          <span>{t("settings.proactiveEnable")}</span>
        </label>
        <label className="interval-label">
          <span>{t("settings.proactiveCooldown")}</span>
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={petCadence ? petCadence.cooldown : draft.proactive_cooldown_minutes}
            placeholder={
              petCadence ? String(draft.proactive_cooldown_minutes) : undefined
            }
            disabled={!draft.proactive_enabled}
            onChange={(e) => {
              if (petCadence) {
                setPetSage({ ...petCadence, cooldown: e.currentTarget.value, dirty: true });
              } else {
                patch({
                  proactive_cooldown_minutes: Math.max(
                    0.5,
                    Number(e.currentTarget.value) || 0,
                  ),
                });
              }
            }}
          />
        </label>
        <label className="interval-label">
          <span>{t("settings.proactiveMaxPerHour")}</span>
          <input
            type="number"
            min={0}
            step={1}
            value={petCadence ? petCadence.maxPerHour : draft.proactive_max_per_hour}
            placeholder={
              petCadence
                ? draft.proactive_max_per_hour === 0
                  ? t("settings.proactiveUnlimited")
                  : String(draft.proactive_max_per_hour)
                : undefined
            }
            disabled={!draft.proactive_enabled}
            onChange={(e) => {
              if (petCadence) {
                setPetSage({
                  ...petCadence,
                  maxPerHour: e.currentTarget.value,
                  dirty: true,
                });
              } else {
                patch({
                  proactive_max_per_hour: Math.max(
                    0,
                    Math.floor(Number(e.currentTarget.value) || 0),
                  ),
                });
              }
            }}
          />
        </label>
      </div>
      <span className="field-hint">
        {petCadence
          ? t("settings.proactivePetHint", {
              cooldown: draft.proactive_cooldown_minutes,
              max:
                draft.proactive_max_per_hour === 0
                  ? t("settings.proactiveUnlimited")
                  : draft.proactive_max_per_hour,
            })
          : t("settings.proactiveHint")}
      </span>
    </div>
  );
}
