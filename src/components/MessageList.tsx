// Message column of the chat bubble: user/assistant bubbles, tool cards,
// and the in-flight streaming bubble with its cursor.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../ipc/contract.ts";
import { useCompanionName } from "../store/companion.ts";
import { ToolCallCard } from "./ToolCallCard.tsx";

interface Props {
  messages: ChatMessage[];
  partial: string;
  streaming: boolean;
}

export function MessageList({ messages, partial, streaming }: Props) {
  const { t } = useTranslation();
  const name = useCompanionName();
  const endRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="messages">
      {messages.length === 0 && !streaming && (
        <div className="messages-empty">
          <p>{t("messages.greeting1", { name })}</p>
          <p>{t("messages.greeting2")}</p>
        </div>
      )}
      {messages.map((message, index) => {
        if (message.role === "tool" || message.role === "system") return null;
        const text = contentText(message.content);
        return (
          <div key={index} className={`msg msg-${message.role}`}>
            {text && <div className="msg-bubble">{text}</div>}
            {message.tool_calls?.map((call) => (
              <ToolCallCard
                key={call.id}
                call={call}
                result={toolResults.get(call.id)}
              />
            ))}
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
