// Settings › Companion: pick/import a pet and edit the active persona
// (custom_persona for built-in Sage, or the pet's sage.persona).
import { useTranslation } from "react-i18next";
import type { PetMeta, Settings } from "../../ipc/contract.ts";
import type { PatchSettings, PetSageDraft } from "./settingsForm.ts";

interface Props {
  draft: Settings;
  patch: PatchSettings;
  pets: PetMeta[];
  importing: boolean;
  importError: boolean;
  onImportPet: () => void;
  petSage: PetSageDraft | null;
  setPetSage: (next: PetSageDraft) => void;
  petSageError: boolean;
}

export function CompanionSection({
  draft,
  patch,
  pets,
  importing,
  importError,
  onImportPet,
  petSage,
  setPetSage,
  petSageError,
}: Props) {
  const { t } = useTranslation();
  return (
    <>
      <label className="field">
        <span>{t("settings.companion")}</span>
        <select
          value={draft.active_pet}
          onChange={(e) => patch({ active_pet: e.currentTarget.value })}
        >
          <option value="">{t("settings.companionBuiltin")}</option>
          {draft.active_pet && !pets.some((p) => p.id === draft.active_pet) && (
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
          onClick={onImportPet}
        >
          {importing ? t("settings.importing") : t("settings.importPet")}
        </button>
        {importError && (
          <span className="field-hint">{t("settings.importError")}</span>
        )}
      </label>

      {draft.active_pet.trim() === "" ? (
        <label className="field">
          <span>{t("settings.persona")}</span>
          <textarea
            rows={4}
            value={draft.custom_persona}
            placeholder={t("persona.default", { ns: "prompt" })}
            onChange={(e) => patch({ custom_persona: e.currentTarget.value })}
          />
          <span className="field-hint">{t("settings.personaBuiltinHint")}</span>
        </label>
      ) : (
        petSage && (
          <label className="field">
            <span>{t("settings.persona")}</span>
            <textarea
              rows={4}
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
            {petSageError && (
              <span className="field-hint field-hint-error">
                {t("settings.petSageError")}
              </span>
            )}
          </label>
        )
      )}
    </>
  );
}
