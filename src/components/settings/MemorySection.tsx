// Settings › Memory: the long-term-memory switch, the memory manager and the
// archived-conversation browser. The manager/browser mutate through IPC
// immediately (they're data operations, not draft fields) and load fresh on
// every mount — the section remounts whenever the settings window reopens.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ArchiveMeta,
  ChatMessage,
  MemoryMeta,
  Settings,
} from "../../ipc/contract.ts";
import { requireIpc } from "../../store/ipc.ts";
import type { PatchSettings } from "./settingsForm.ts";

interface Props {
  draft: Settings;
  patch: PatchSettings;
}

export function MemorySection({ draft, patch }: Props) {
  const { t } = useTranslation();
  const [memories, setMemories] = useState<MemoryMeta[]>([]);
  const [memoriesError, setMemoriesError] = useState(false);
  const [editing, setEditing] = useState<{
    name: string;
    description: string;
    body: string;
  } | null>(null);
  // Two-click gate for "forget everything" (no modal in this UI).
  const [deleteAllArmed, setDeleteAllArmed] = useState(false);
  const [archives, setArchives] = useState<ArchiveMeta[]>([]);
  const [archivesError, setArchivesError] = useState(false);
  const [viewing, setViewing] = useState<{ id: string; messages: ChatMessage[] } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await requireIpc().listMemories();
        if (!cancelled) {
          setMemories(list);
          setMemoriesError(false);
        }
      } catch {
        if (!cancelled) setMemoriesError(true);
      }
      try {
        const list = await requireIpc().listArchives();
        if (!cancelled) {
          setArchives(list);
          setArchivesError(false);
        }
      } catch {
        if (!cancelled) setArchivesError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Memory manager helpers (all errors surface inline, never throw) ---
  const refreshMemories = async () => {
    try {
      setMemories(await requireIpc().listMemories());
      setMemoriesError(false);
    } catch {
      setMemoriesError(true);
    }
  };

  const deleteMemory = async (name: string) => {
    try {
      await requireIpc().forgetMemory(name);
      if (editing?.name === name) setEditing(null);
      await refreshMemories();
    } catch {
      setMemoriesError(true);
    }
  };

  const deleteAllMemories = async () => {
    if (!deleteAllArmed) {
      setDeleteAllArmed(true); // arm; a second click confirms
      return;
    }
    setDeleteAllArmed(false);
    try {
      for (const m of memories) {
        await requireIpc().forgetMemory(m.name);
      }
    } catch {
      setMemoriesError(true);
    }
    setEditing(null);
    await refreshMemories();
  };

  // Editing needs the full body (the list carries only name + description).
  const beginEdit = async (name: string) => {
    try {
      const body = await requireIpc().readMemory(name);
      const meta = memories.find((m) => m.name === name);
      setEditing({ name, description: meta?.description ?? "", body });
      setMemoriesError(false);
    } catch {
      setMemoriesError(true);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      // Same name overwrites the existing memory (memory.rs slug-file rule).
      await requireIpc().saveMemory(editing.name, editing.description, editing.body);
      setEditing(null);
      await refreshMemories();
    } catch {
      setMemoriesError(true);
    }
  };

  // --- Archive browser helpers ---
  const viewArchive = async (id: string) => {
    try {
      const msgs = await requireIpc().readArchive(id);
      setViewing({ id, messages: msgs });
      setArchivesError(false);
    } catch {
      setArchivesError(true);
    }
  };

  const removeArchive = async (id: string) => {
    try {
      await requireIpc().deleteArchive(id);
      if (viewing?.id === id) setViewing(null);
      setArchives(await requireIpc().listArchives());
      setArchivesError(false);
    } catch {
      setArchivesError(true);
    }
  };

  return (
    <>
      <div className="field">
        <label className="switch-label">
          <input
            type="checkbox"
            checked={draft.memory_enabled}
            onChange={(e) => patch({ memory_enabled: e.currentTarget.checked })}
          />
          <span>{t("settings.memoryEnable")}</span>
        </label>
        <span className="field-hint">{t("settings.memoryHint")}</span>
      </div>

      <div className="field">
        <span className="section-label">{t("settings.memoryManager")}</span>
        {memoriesError && (
          <span className="field-hint field-hint-error">
            {t("settings.memoryError")}
          </span>
        )}
        {memories.length === 0 ? (
          <span className="field-hint">{t("settings.memoryEmpty")}</span>
        ) : (
          <ul className="record-list">
            {memories.map((m) => (
              <li key={m.name} className="record-item">
                <div className="record-meta">
                  <strong>{m.name}</strong>
                  <span>{m.description}</span>
                </div>
                <div className="record-actions">
                  <button type="button" onClick={() => void beginEdit(m.name)}>
                    {t("settings.memoryEdit")}
                  </button>
                  <button type="button" onClick={() => void deleteMemory(m.name)}>
                    {t("settings.memoryDelete")}
                  </button>
                </div>
                {editing?.name === m.name && (
                  <div className="record-edit">
                    <input
                      type="text"
                      value={editing.description}
                      placeholder={t("settings.memoryDescPlaceholder")}
                      onChange={(e) =>
                        setEditing({ ...editing, description: e.currentTarget.value })
                      }
                    />
                    <textarea
                      rows={3}
                      value={editing.body}
                      placeholder={t("settings.memoryBodyPlaceholder")}
                      onChange={(e) =>
                        setEditing({ ...editing, body: e.currentTarget.value })
                      }
                    />
                    <div className="record-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void saveEdit()}
                      >
                        {t("settings.memorySave")}
                      </button>
                      <button type="button" onClick={() => setEditing(null)}>
                        {t("settings.cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {memories.length > 0 && (
          <button
            type="button"
            className={`record-danger${deleteAllArmed ? " armed" : ""}`}
            onClick={() => void deleteAllMemories()}
          >
            {deleteAllArmed
              ? t("settings.memoryDeleteAllConfirm")
              : t("settings.memoryDeleteAll")}
          </button>
        )}
      </div>

      <div className="field">
        <span className="section-label">{t("settings.archives")}</span>
        {archivesError && (
          <span className="field-hint field-hint-error">
            {t("settings.archivesError")}
          </span>
        )}
        {archives.length === 0 ? (
          <span className="field-hint">{t("settings.archivesEmpty")}</span>
        ) : (
          <ul className="record-list">
            {archives.map((a) => (
              <li key={a.id} className="record-item">
                <div className="record-meta">
                  <strong>{a.saved_at}</strong>
                  <span>
                    {t("settings.archiveMessages", { count: a.message_count })}
                  </span>
                </div>
                <div className="record-actions">
                  <button type="button" onClick={() => void viewArchive(a.id)}>
                    {t("settings.archiveView")}
                  </button>
                  <button type="button" onClick={() => void removeArchive(a.id)}>
                    {t("settings.archiveDelete")}
                  </button>
                </div>
                {viewing?.id === a.id && (
                  <div className="archive-transcript">
                    {viewing.messages.map((msg, i) => (
                      <p key={i} className="archive-line">
                        <strong>{msg.role}:</strong>{" "}
                        {typeof msg.content === "string"
                          ? msg.content
                          : JSON.stringify(msg.content)}
                      </p>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
