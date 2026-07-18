// S4.3 — Collapsible transparency card for a tool call: name + argument JSON
// + first lines of the result, expandable to full text.
import { useState } from "react";
import type { ToolCall } from "../ipc/contract.ts";

interface Props {
  call: ToolCall;
  /** Matching role:"tool" message content, once it has arrived. */
  result?: string;
}

const PREVIEW_LINES = 3;

export function ToolCallCard({ call, result }: Props) {
  const [open, setOpen] = useState(false);
  const lines = (result ?? "").split("\n");
  const preview = lines.slice(0, PREVIEW_LINES).join("\n");
  const truncated = lines.length > PREVIEW_LINES;

  return (
    <div className={`tool-card${open ? " open" : ""}`}>
      <button
        type="button"
        className="tool-card-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="tool-card-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="tool-card-name">{call.function.name}</span>
        <span className="tool-card-tag">
          {result === undefined ? "執行中…" : "工具"}
        </span>
      </button>
      {open ? (
        <div className="tool-card-body">
          <div className="tool-card-label">參數</div>
          <pre>{prettyJson(call.function.arguments)}</pre>
          <div className="tool-card-label">回傳</div>
          <pre>{result ?? "（還沒有結果）"}</pre>
        </div>
      ) : (
        result !== undefined &&
        preview && (
          <pre className="tool-card-preview">
            {preview}
            {truncated ? "\n…" : ""}
          </pre>
        )
      )}
    </div>
  );
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
