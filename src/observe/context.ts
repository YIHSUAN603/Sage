// S5.4 — Build the system message that injects recent observation context
// into a chat request. Pure function: chat store passes the snapshot ring
// (store/observation.ts) and the current time; returns null when there is
// nothing useful to say. The message goes into the request only — never into
// the visible history (MessageList hides role:"system" anyway).
import i18n from "../i18n/index.ts";
import type { ChatMessage } from "../ipc/contract.ts";
import type { ContextSnapshot } from "../store/observation.ts";

/** How many window runs (newest first) to describe. */
const MAX_RUNS = 5;

interface Run {
  app_name: string;
  title: string;
  start: number;
  end: number;
}

function describeMs(ms: number): string {
  const min = Math.round(ms / 60_000);
  return min < 1
    ? i18n.t("context.underMinute", { ns: "prompt" })
    : i18n.t("context.minutes", { ns: "prompt", count: min });
}

export function buildContextMessage(
  recent: ContextSnapshot[],
  now: number,
): ChatMessage | null {
  // Collapse consecutive snapshots of the same window into dwell runs.
  const runs: Run[] = [];
  for (const snap of recent) {
    if (!snap.window) continue; // active_window unavailable — skip
    const last = runs[runs.length - 1];
    if (
      last &&
      last.app_name === snap.window.app_name &&
      last.title === snap.window.title
    ) {
      last.end = snap.at;
    } else {
      runs.push({ ...snap.window, start: snap.at, end: snap.at });
    }
  }
  if (runs.length === 0) return null;

  const lines = runs
    .slice(-MAX_RUNS)
    .reverse()
    .map((run, index) => {
      const dwell = index === 0 ? now - run.start : run.end - run.start;
      const label = i18n.t(index === 0 ? "context.current" : "context.earlier", {
        ns: "prompt",
      });
      return i18n.t("context.line", {
        ns: "prompt",
        label,
        app: run.app_name,
        title: run.title,
        dwell: describeMs(dwell),
      });
    });

  return {
    role: "system",
    content: [i18n.t("context.intro", { ns: "prompt" }), lines.join("\n")].join(
      "\n",
    ),
  };
}
