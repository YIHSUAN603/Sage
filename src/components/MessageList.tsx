// Message column of the chat bubble: user/assistant bubbles, tool cards,
// date separators + times, hover actions (copy / regenerate) and the
// in-flight streaming bubble with its cursor.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../ipc/contract.ts";
import { useCompanionName } from "../store/companion.ts";
import { copyText } from "./copyText.ts";
import { annotateTimeline, formatDate, formatTime } from "./messageTime.ts";
import { ToolCallCard } from "./ToolCallCard.tsx";

interface Props {
  messages: ChatMessage[];
  partial: string;
  streaming: boolean;
  onRegenerate: () => void;
}

export function MessageList({ messages, partial, streaming, onRegenerate }: Props) {
  const { t, i18n } = useTranslation();
  const name = useCompanionName();
  const endRef = useRef<HTMLDivElement>(null);
  // Which message currently shows the "copied" feedback on its copy button.
  const [copied, setCopied] = useState<number | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, partial, streaming]);

  // role:"tool" results render inside their assistant's card, keyed by id.
  const toolResults = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "tool" && m.tool_call_id) {
      toolResults.set(m.tool_call_id, contentText(m.content));
    }
  }

  const timeline = annotateTimeline(messages, Date.now());
  const locale = i18n.language;
  // Regenerate only offers on the last visible message, when it's an
  // assistant answer to some user message and nothing is streaming.
  let lastVisible = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" || messages[i].role === "assistant") {
      lastVisible = i;
      break;
    }
  }
  const canRegenerate =
    !streaming &&
    lastVisible >= 0 &&
    messages[lastVisible].role === "assistant" &&
    messages.some((m) => m.role === "user");

  const handleCopy = (index: number, text: string) => {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(index);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div className="messages">
      {messages.length === 0 && !streaming && (
        <div className="messages-empty">
          <span className="messages-empty-dot" aria-hidden />
          <p>{t("messages.greeting1", { name })}</p>
          <p>{t("messages.greeting2")}</p>
        </div>
      )}
      {messages.map((message, index) => {
        if (message.role === "tool" || message.role === "system") return null;
        const text = contentText(message.content);
        const ann = timeline[index];
        const sep = ann.dateSep;
        return (
          <div key={index} className="msg-slot">
            {sep !== null && (
              <div className="msg-date-sep" role="separator">
                <span>
                  {sep === "today"
                    ? t("chat.today")
                    : sep === "yesterday"
                      ? t("chat.yesterday")
                      : formatDate(sep, Date.now(), locale)}
                </span>
              </div>
            )}
            <div
              className={`msg msg-${message.role}${ann.groupEnd ? " msg-group-end" : ""}`}
            >
              {text && <div className="msg-bubble">{text}</div>}
              {message.tool_calls?.map((call) => (
                <ToolCallCard
                  key={call.id}
                  call={call}
                  result={toolResults.get(call.id)}
                />
              ))}
              {text && (
                <div className="msg-actions">
                  <button
                    type="button"
                    className="msg-action-btn"
                    title={copied === index ? t("chat.copied") : t("chat.copy")}
                    aria-label={copied === index ? t("chat.copied") : t("chat.copy")}
                    onClick={() => handleCopy(index, text)}
                  >
                    {copied === index ? "✓" : "⧉"}
                  </button>
                  {canRegenerate && index === lastVisible && (
                    <button
                      type="button"
                      className="msg-action-btn"
                      title={t("chat.regenerate")}
                      aria-label={t("chat.regenerate")}
                      onClick={onRegenerate}
                    >
                      ↻
                    </button>
                  )}
                </div>
              )}
              {ann.showTime && typeof message.ts === "number" && (
                <div className="msg-time">{formatTime(message.ts, locale)}</div>
              )}
            </div>
          </div>
        );
      })}
      {streaming && (
        <div className="msg msg-assistant">
          <div className="msg-bubble">
            {partial}
            <span className="stream-cursor" aria-hidden />
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function contentText(content: ChatMessage["content"]): string {
  if (content === null) return "";
  if (typeof content === "string") return content;
  return content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
}
