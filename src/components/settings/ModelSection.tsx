// Settings › Model: backend switch, OpenRouter key + model slots, or the
// local agent CLI (binary / model preset / tool permission). The CLI probe
// and the Custom… model mode are local to this section — remounting on tab
// switch simply re-derives / re-probes them.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Settings } from "../../ipc/contract.ts";
import { requireIpc } from "../../store/ipc.ts";
import {
  AGENT_PERMISSIONS,
  normalizePermission,
  PERMISSION_HINT_KEY,
  PERMISSION_LABEL_KEY,
} from "../agentPermission.ts";
import { ModelField } from "./ModelField.tsx";
import {
  AGENT_MODEL_PRESETS,
  CUSTOM_MODEL,
  isModelPreset,
  type ModelOption,
  type PatchSettings,
} from "./settingsForm.ts";

interface Props {
  draft: Settings;
  patch: PatchSettings;
  chatModels: ModelOption[];
  observeModels: ModelOption[];
  modelsError: boolean;
}

export function ModelSection({
  draft,
  patch,
  chatModels,
  observeModels,
  modelsError,
}: Props) {
  const { t } = useTranslation();
  const useAgentCli = draft.backend === "agent_cli";
  // Whether the model dropdown is in "Custom…" mode (free-text id, not a preset).
  const [customModel, setCustomModel] = useState(
    () => !isModelPreset(draft.agent_cli, draft.agent_cli_model),
  );
  const [cliCheck, setCliCheck] = useState<{
    status: "checking" | "ok" | "missing";
    text: string;
  } | null>(null);

  // Probe the selected agent CLI (debounced) so a missing binary shows up here
  // rather than as a cryptic error on the first message.
  useEffect(() => {
    if (!useAgentCli) {
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
          () =>
            !cancelled &&
            setCliCheck({ status: "missing", text: t("settings.agentCliMissing") }),
        );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [useAgentCli, draft.agent_cli, draft.agent_cli_path, t]);

  return (
    <>
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
    </>
  );
}
