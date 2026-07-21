// Resolves the current companion's persona for the chat + proactive gate.
// A pet with a custom `persona` uses it verbatim; a plain hatch-pet folder
// (no persona) gets one synthesized from its name + description; with no pet
// selected we fall back to the built-in Sage identity. The pet manifest is
// re-read from disk on demand (cheap local fs), same freshness policy as skills.
import i18n from "../i18n/index.ts";
import type { Pet } from "../ipc/contract.ts";
import { requireIpc } from "./ipc.ts";
import { useSettingsStore } from "./settings.ts";

async function activePet(): Promise<Pet | null> {
  const id = useSettingsStore.getState().settings.active_pet.trim();
  if (!id) return null;
  try {
    return await requireIpc().readPet(id);
  } catch {
    return null; // unknown / unreadable pet → fall back to built-in
  }
}

/** The character identity + tone. Used by chat, and as the gate's base. */
export async function personaIdentity(): Promise<string> {
  const pet = await activePet();
  if (!pet) {
    const custom = useSettingsStore.getState().settings.custom_persona.trim();
    return custom || i18n.t("persona.default", { ns: "prompt" });
  }
  if (pet.persona) return pet.persona;
  const base = i18n.t("persona.synthBase", { ns: "prompt", name: pet.displayName });
  const desc = pet.description.trim();
  return desc ? `${base}\n${desc}` : base;
}

/** The proactive-gate system prompt = persona identity + the gate protocol. */
export async function gateSystem(): Promise<string> {
  const persona = await personaIdentity();
  return `${persona}\n${i18n.t("gate.protocol", { ns: "prompt" })}`;
}

/** Effective proactive tuning for the observe loop. */
export interface ProactiveTuning {
  /** Minimum minutes between proactive asks. */
  cooldownMinutes: number;
  /** Max bubbles per rolling hour; 0 = unlimited. */
  maxPerHour: number;
}

/**
 * Resolve the proactive-chatter tuning: the active pet's `sage.proactive`
 * overrides the global settings values (which carry the built-in defaults).
 */
export async function proactiveTuning(): Promise<ProactiveTuning> {
  const s = useSettingsStore.getState().settings;
  const pet = await activePet();
  return {
    cooldownMinutes: pet?.proactive?.cooldownMinutes ?? s.proactive_cooldown_minutes,
    maxPerHour: pet?.proactive?.maxPerHour ?? s.proactive_max_per_hour,
  };
}

/**
 * The chat system prompt, or null when no companion is selected — in which
 * case chat stays exactly as it was (no persona system message injected).
 */
export async function chatPersonaSystem(): Promise<string | null> {
  const id = useSettingsStore.getState().settings.active_pet.trim();
  if (!id) return null;
  return personaIdentity();
}
