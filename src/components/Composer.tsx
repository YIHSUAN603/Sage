// Composer: Enter sends, Shift+Enter breaks the line; while streaming the
// send button becomes a stop button. Without an API key it shows guidance.
import { useState } from "react";

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
  const [draft, setDraft] = useState("");

  if (!hasKey) {
    return (
      <div className="composer composer-guide">
        <p>還沒有 OpenRouter API key，Sage 說不了話。</p>
        <button type="button" onClick={onOpenSettings}>
          打開設定貼上 key
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
        placeholder="跟 Sage 說點什麼…"
        aria-label="訊息輸入"
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
          title="停止回應"
          aria-label="停止回應"
        >
          ■
        </button>
      ) : (
        <button
          type="submit"
          className="composer-btn composer-send"
          disabled={!draft.trim()}
          title="送出（Enter）"
          aria-label="送出"
        >
          ↑
        </button>
      )}
    </form>
  );
}
