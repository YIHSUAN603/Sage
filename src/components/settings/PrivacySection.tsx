// Settings › Observation & privacy: the observation switch, interval,
// zero-retention routing (OpenRouter only) and the sensitive-window blocklist.
import { useTranslation } from "react-i18next";
import type { Settings } from "../../ipc/contract.ts";
import { parseBlocklist, type PatchSettings } from "./settingsForm.ts";

interface Props {
  draft: Settings;
  patch: PatchSettings;
  /** Raw textarea text (one entry per line) so typing isn't disturbed. */
  blocklistText: string;
  setBlocklistText: (text: string) => void;
}

export function PrivacySection({
  draft,
  patch,
  blocklistText,
  setBlocklistText,
}: Props) {
  const { t } = useTranslation();
  const useAgentCli = draft.backend === "agent_cli";

  return (
    <>
      <div className="field">
        <div className="field field-row">
          <label className="switch-label">
            <input
              type="checkbox"
              checked={draft.observe_enabled}
              onChange={(e) => patch({ observe_enabled: e.currentTarget.checked })}
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
        <span className="field-hint">{t("settings.observeHint")}</span>
        <span className="field-hint">{t("settings.axPermissionHint")}</span>
      </div>

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

      <div className="field">
        <label className="switch-label">
          <input
            type="checkbox"
            checked={draft.observe_agents}
            onChange={(e) => patch({ observe_agents: e.currentTarget.checked })}
          />
          <span>{t("settings.agentsEnable")}</span>
        </label>
        <span className="field-hint">{t("settings.agentsHint")}</span>
      </div>
    </>
  );
}
