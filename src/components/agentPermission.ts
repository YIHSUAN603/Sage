// Shared vocabulary for the agent-CLI tool permission tiers: the settings
// dropdown and the chat-header quick toggle must agree on order, icons and
// i18n keys. Enforcement lives in Rust (agent_cli.rs) — this is display only.
import type { Settings } from "../ipc/contract.ts";

export type AgentPermission = Settings["agent_cli_permission"];

/** Cycle order for the chat-header toggle. */
export const AGENT_PERMISSIONS: AgentPermission[] = ["read_only", "edit", "full"];

export const PERMISSION_ICON: Record<AgentPermission, string> = {
  read_only: "🔒",
  edit: "✏️",
  full: "🔓",
};

// `as const` so `t()` sees literal key types (i18next's typed keys reject string).
export const PERMISSION_LABEL_KEY = {
  read_only: "settings.agentCliPermReadOnly",
  edit: "settings.agentCliPermEdit",
  full: "settings.agentCliPermFull",
} as const satisfies Record<AgentPermission, string>;

export const PERMISSION_HINT_KEY = {
  read_only: "settings.agentCliPermReadOnlyHint",
  edit: "settings.agentCliPermEditHint",
  full: "settings.agentCliPermFullHint",
} as const satisfies Record<AgentPermission, string>;

/** Settings saved by an older build may miss the field — treat as read_only. */
export function normalizePermission(value: AgentPermission | undefined): AgentPermission {
  return value && AGENT_PERMISSIONS.includes(value) ? value : "read_only";
}

export function nextPermission(current: AgentPermission): AgentPermission {
  const idx = AGENT_PERMISSIONS.indexOf(normalizePermission(current));
  return AGENT_PERMISSIONS[(idx + 1) % AGENT_PERMISSIONS.length];
}
