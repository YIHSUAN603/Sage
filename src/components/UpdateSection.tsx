// 設定底部的應用更新區塊：顯示目前版本，一顆按鈕走完
// 檢查 → 下載安裝 → 重啟 的狀態機。更新來源是 GitHub Release 的
// latest.json（tauri-plugin-updater），簽章驗證由 plugin 處理。
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Phase =
  | { name: "idle" }
  | { name: "checking" }
  | { name: "none" }
  | { name: "available"; update: Update }
  | { name: "downloading"; percent: number }
  | { name: "ready" }
  | { name: "error" };

export function UpdateSection() {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "idle" });

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const checkForUpdate = async () => {
    setPhase({ name: "checking" });
    try {
      const update = await check();
      setPhase(update ? { name: "available", update } : { name: "none" });
    } catch {
      // dev（無打包簽章）或離線都會走到這裡——顯示錯誤讓使用者重試即可。
      setPhase({ name: "error" });
    }
  };

  const downloadAndInstall = async (update: Update) => {
    setPhase({ name: "downloading", percent: 0 });
    try {
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
          setPhase({ name: "downloading", percent });
        }
      });
      setPhase({ name: "ready" });
    } catch {
      setPhase({ name: "error" });
    }
  };

  const busy = phase.name === "checking" || phase.name === "downloading";

  let buttonText: string;
  let onClick: () => void = checkForUpdate;
  switch (phase.name) {
    case "checking":
      buttonText = t("settings.updateChecking");
      break;
    case "available":
      buttonText = t("settings.updateAvailable", { version: phase.update.version });
      onClick = () => void downloadAndInstall(phase.update);
      break;
    case "downloading":
      buttonText = t("settings.updateDownloading", { percent: phase.percent });
      break;
    case "ready":
      buttonText = t("settings.updateRestart");
      onClick = () => void relaunch();
      break;
    default:
      buttonText = t("settings.updateCheck");
  }

  return (
    <div className="field">
      <span>
        {t("settings.updateCurrent", { version })}
        {phase.name === "none" && `（${t("settings.updateNone")}）`}
      </span>
      <button type="button" disabled={busy} onClick={onClick}>
        {buttonText}
      </button>
      {phase.name === "error" && (
        <span className="field-hint field-hint-error">{t("settings.updateError")}</span>
      )}
    </div>
  );
}
