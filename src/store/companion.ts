// The active companion's display name, for UI strings that used to say "Sage".
// Reads active_pet reactively from settings and resolves the pet's displayName
// (falling back to "Sage" when none is selected or the lookup fails).
import { useEffect, useState } from "react";
import { requireIpc } from "./ipc.ts";
import { useSettingsStore } from "./settings.ts";

const DEFAULT_NAME = "Sage";

export function useCompanionName(): string {
  const id = useSettingsStore((s) => s.settings.active_pet);
  const [name, setName] = useState(DEFAULT_NAME);
  useEffect(() => {
    let cancelled = false;
    const pid = id.trim();
    if (!pid) {
      setName(DEFAULT_NAME);
      return;
    }
    void (async () => {
      try {
        const pet = await requireIpc().readPet(pid);
        if (!cancelled) setName(pet.displayName || DEFAULT_NAME);
      } catch {
        if (!cancelled) setName(DEFAULT_NAME);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);
  return name;
}
