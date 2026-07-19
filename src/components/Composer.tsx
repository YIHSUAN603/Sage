// Composer: Enter sends, Shift+Enter breaks the line; while streaming the
// send button becomes a stop button. Without an API key it shows guidance.
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  streaming: boolean;
  hasKey: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onOpenSettings: () => void;
}

export function Composer({
  streaming,
  hasKey,
  onSend,
  onStop,
  onOpenSettings,
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  if (!hasKey) {
    return (
      <div className="composer composer-guide">
        <p>{t("composer.noKey")}</p>
        <button type="button" onClick={onOpenSettings}>
          {t("composer.openSettings")}
        </button>
      </div>
    );
  }

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    onSend(text);
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        value={draft}
        rows={1}
        placeholder={t("composer.placeholder")}
        aria-label={t("composer.inputAria")}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {streaming ? (
        <button
          type="button"
          className="composer-btn composer-stop"
          onClick={onStop}
          title={t("composer.stop")}
          aria-label={t("composer.stop")}
        >
          ■
        </button>
      ) : (
        <button
          type="submit"
          className="composer-btn composer-send"
          disabled={!draft.trim()}
          title={t("composer.sendTitle")}
          aria-label={t("composer.send")}
        >
          ↑
        </button>
      )}
    </form>
  );
}
