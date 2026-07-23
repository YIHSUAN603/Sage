// Pure timeline helpers for MessageList: date separators, time grouping and
// Intl-based formatting. No DOM — Node tests drive this directly.
import type { ChatMessage } from "../ipc/contract.ts";

/** Messages closer than this (same role) collapse into one visual group. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface TimelineAnnotation {
  /**
   * Date separator to render before this message: "today" / "yesterday" for
   * the two relative labels (i18n), an epoch ms for older days (formatted via
   * formatDate), or null for no separator.
   */
  dateSep: "today" | "yesterday" | number | null;
  /** True on the last message of a same-role group (drives group spacing). */
  groupEnd: boolean;
  /** Show this message's time below the bubble (group end + has a ts). */
  showTime: boolean;
}

/**
 * Annotate `messages` one-to-one for rendering. Only user/assistant messages
 * take part (tool/system rows are hidden by the UI); messages without a `ts`
 * (pre-0.5 sessions) never show a time and never join a group.
 */
export function annotateTimeline(
  messages: ChatMessage[],
  now: number,
): TimelineAnnotation[] {
  const out: TimelineAnnotation[] = messages.map(() => ({
    dateSep: null,
    groupEnd: false,
    showTime: false,
  }));
  const visible = messages.flatMap((m, i) =>
    m.role === "user" || m.role === "assistant" ? [i] : [],
  );

  // Date separators: whenever the local calendar day changes between two
  // consecutive stamped messages (unstamped ones are skipped, not guessed).
  let prevTs: number | null = null;
  for (const i of visible) {
    const ts = messages[i].ts;
    if (typeof ts !== "number") continue;
    if (prevTs === null || !sameDay(prevTs, ts)) {
      out[i].dateSep = classifyDay(ts, now);
    }
    prevTs = ts;
  }

  // Grouping: consecutive same-role messages within the window and on the
  // same day form one group; the group's last message carries the time.
  for (let k = 0; k < visible.length; k++) {
    const i = visible[k];
    const ts = messages[i].ts;
    const next = k + 1 < visible.length ? visible[k + 1] : null;
    const nextTs = next === null ? undefined : messages[next].ts;
    const sameGroup =
      next !== null &&
      typeof ts === "number" &&
      typeof nextTs === "number" &&
      messages[next].role === messages[i].role &&
      nextTs - ts < GROUP_WINDOW_MS &&
      out[next].dateSep === null;
    out[i].groupEnd = !sameGroup;
    out[i].showTime = !sameGroup && typeof ts === "number";
  }
  return out;
}

/** "14:05"-style short time in the UI locale. */
export function formatTime(ts: number, locale: string): string {
  return safeFormat(locale, { hour: "2-digit", minute: "2-digit" }, ts);
}

/** Day label for older separators; adds the year when it differs from now. */
export function formatDate(ts: number, now: number, locale: string): string {
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return safeFormat(
    locale,
    sameYear
      ? { month: "long", day: "numeric" }
      : { year: "numeric", month: "long", day: "numeric" },
    ts,
  );
}

function safeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
  ts: number,
): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(ts);
  } catch {
    // Unknown locale tag (e.g. before i18n settles) — fall back to the system.
    return new Intl.DateTimeFormat(undefined, options).format(ts);
  }
}

function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function classifyDay(ts: number, now: number): "today" | "yesterday" | number {
  if (sameDay(ts, now)) return "today";
  const n = new Date(now);
  const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  return sameDay(ts, yesterday.getTime()) ? "yesterday" : ts;
}
