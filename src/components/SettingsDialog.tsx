// S4.4 — Settings modal inside the chat window: API key, the two model
// slots (chat needs `tools`, observe needs image input), and the
// observation switch with its privacy note.
import { useEffect, useState, type FormEvent } from "react";
import type { Settings } from "../ipc/contract.ts";
import { useSettingsStore } from "../store/settings.ts";

/**
 * 模型清單載入介面（llm/models.ts 的 fetchFreeToolModels /
 * fetchFreeVisionModels）。載入失敗或回空陣列時，欄位退化成
 * 「手填 model id 的 text input + datalist」。
 */
export interface ModelOption {
  id: string;
  name: string;
  recommended?: boolean;
}
export type LoadModels = () => Promise<ModelOption[]>;

const loadModelsPlaceholder: LoadModels = async () => [];

function sortRecommendedFirst(models: ModelOption[]): ModelOption[] {
  return [...models].sort(
    (a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false),
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 免費且支援 tools 的模型清單。 */
  loadChatModels?: LoadModels;
  /** 免費且支援 image 輸入的模型清單。 */
  loadObserveModels?: LoadModels;
}

export function SettingsDialog({
  open,
  onClose,
  loadChatModels = loadModelsPlaceholder,
  loadObserveModels = loadModelsPlaceholder,
}: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const save = useSettingsStore((s) => s.save);
  const saving = useSettingsStore((s) => s.saving);
  const error = useSettingsStore((s) => s.error);

  const [draft, setDraft] = useState<Settings>(settings);
  const [chatModels, setChatModels] = useState<ModelOption[]>([]);
  const [observeModels, setObserveModels] = useState<ModelOption[]>([]);
  const [modelsError, setModelsError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(useSettingsStore.getState().settings);
    setModelsError(false);
    let cancelled = false;
    loadChatModels()
      .then((models) => !cancelled && setChatModels(sortRecommendedFirst(models)))
      .catch(() => !cancelled && setModelsError(true));
    loadObserveModels()
      .then((models) => !cancelled && setObserveModels(sortRecommendedFirst(models)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, loadChatModels, loadObserveModels]);

  if (!open) return null;

  const patch = (p: Partial<Settings>) => setDraft((d) => ({ ...d, ...p }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await save(draft);
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2>設定</h2>

        <label className="field">
          <span>OpenRouter API key</span>
          <input
            type="password"
            value={draft.api_key}
            placeholder="sk-or-…"
            autoComplete="off"
            onChange={(e) => patch({ api_key: e.currentTarget.value })}
          />
        </label>

        <label className="field">
          <span>聊天模型（必填，需支援 tools）</span>
          <input
            type="text"
            list="chat-model-options"
            value={draft.chat_model}
            placeholder="點一下從清單挑選，或直接填 model id"
            onChange={(e) => patch({ chat_model: e.currentTarget.value })}
          />
          {modelsError && (
            <span className="field-hint">
              模型清單載入失敗——請自行填入 OpenRouter model id（例：
              google/gemma-4-26b-a4b-it:free）。
            </span>
          )}
          <datalist id="chat-model-options">
            {chatModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name + (m.recommended ? "（推薦：tools+vision 通吃）" : "")}
              </option>
            ))}
          </datalist>
        </label>

        <label className="field">
          <span>觀察模型（需支援圖片輸入）</span>
          <input
            type="text"
            list="observe-model-options"
            value={draft.observe_model}
            placeholder="可與聊天模型相同"
            onChange={(e) => patch({ observe_model: e.currentTarget.value })}
          />
          <datalist id="observe-model-options">
            {observeModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name + (m.recommended ? "（推薦：tools+vision 通吃）" : "")}
              </option>
            ))}
          </datalist>
        </label>

        <div className="field field-row">
          <label className="switch-label">
            <input
              type="checkbox"
              checked={draft.observe_enabled}
              onChange={(e) =>
                patch({ observe_enabled: e.currentTarget.checked })
              }
            />
            <span>開啟觀察（預設關閉）</span>
          </label>
          <label className="interval-label">
            <span>間隔</span>
            <input
              type="number"
              min={2}
              max={600}
              value={draft.observe_interval}
              disabled={!draft.observe_enabled}
              onChange={(e) =>
                patch({
                  observe_interval: Math.max(
                    2,
                    Math.floor(Number(e.currentTarget.value) || 0),
                  ),
                })
              }
            />
            <span>秒</span>
          </label>
        </div>

        <p className="privacy-note">
          觀察開啟後，Sage 會定期讀取目前視窗標題，必要時擷取螢幕縮圖送往
          OpenRouter 判斷「有沒有值得一提的事」。截圖只在記憶體中處理、
          送出後即丟棄，不會存檔；關閉觀察即完全停止一切擷取與上傳。
        </p>

        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? "儲存中…" : "儲存"}
          </button>
        </div>
      </form>
    </div>
  );
}
