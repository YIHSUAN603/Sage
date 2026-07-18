# Sage — 桌面浮動 AI 小夥伴｜敏捷開發規劃 + 多工處理文件

## Context

全新桌面 AI 助手專案 **Sage**（非 Helm 一部分），使用 **OpenRouter 免費模型**。

**UX 定位（本次調整重點）**：不是一個聊天視窗，而是一個**常駐桌面的浮動小夥伴**——一個置頂、可拖拉的小角色/icon 漂在桌面上；點它就展開對話。它會**觀察你在做什麼**（螢幕截圖 + 目前視窗標題），平常**安靜不打擾**，偵測到值得一提的脈絡才**冒泡**搭話，像個陪你一起工作的夥伴。

已對齊決策：
- **專案名/位置**：Sage，`/Volumes/Transcend/sideProject/Sage`
- **技術棧**：Tauri 2 + React 19 + TypeScript（同 Helm，使用者最熟）
- **小夥伴形態**：桌面浮動角色（置頂、透明、可拖拉；點擊展開對話氣泡）
- **觀察方式**：① 目前 app/視窗標題（輕量、頻繁）② 螢幕截圖 + 視覺模型（耗費、節流/按需）
- **主動性**：預設安靜，偵測到值得一提時才冒泡（有冷卻，保護免費額度也不擾人）
- **工具**：MVP 先打通 `read_file`；長期擴充 web/MCP/自訂函式
- **API key**：已有，於設定頁輸入、存本機（不進版控）

核心架構原則（沿用 Helm）：**Rust 只提供能力（HTTP 串流、工具執行、螢幕擷取、視窗查詢），前端負責編排與狀態**；工具用**資料驅動 registry**，新增工具不改核心迴圈。

**OpenRouter 已確認事實**（WebFetch 於 `/api/v1/models` 驗證）：
- OpenAI 相容端點 `POST /api/v1/chat/completions`（`stream:true` 走 SSE）；訊息可含圖片 content part（`image_url` 帶 data URL）供視覺模型。
- 免費模型不寫死：每個 model 有 `pricing.prompt`（`"0"`=免費）、`supported_parameters`（含 `"tools"`=支援 function calling）、`architecture.input_modalities`（含 `"image"`=支援視覺輸入）。前端動態篩選。
- 存在少數**同時**支援 `tools` + `image` 的免費模型；否則聊天/觀察分兩個模型槽。

> 本文件為**規劃**，不含實作。工項可分派給多個平行 agent/開發者。

---

## 敏捷框架

- **交付節奏**：Sprint 1 = 小夥伴外殼 + 聊天 + `read_file` 打通；Sprint 2 = 觀察與主動冒泡。
- **估點**：Fibonacci（1/2/3/5/8），1 點 ≈ 半天。
- **Definition of Done**：程式碼合入、`tsc` + `cargo check` 通過、純函式有 Node test、手動 E2E 驗收滿足、**API key 不外洩**、**觀察需明確開啟且可隨時暫停**。

---

## Product Backlog

### EPIC 0 — 專案骨架與契約（阻塞所有人，最先做）

| ID | User Story | 驗收條件 | 點 | 相依 |
|----|-----------|---------|----|----|
| S0.1 | 可跑起來的 Tauri+React+TS 樣板 | `npm create tauri-app`(React/TS) 建於 `Sage/`；`CARGO_TARGET_DIR` 指向 APFS（避 exFAT `._` build 崩潰）；`npm run tauri dev` 開得起來 | 3 | — |
| S0.2 | 凍結的 **IPC 契約**（命令+型別），讓各軌平行 | `src/ipc/contract.ts` 定義型別與命令簽章：`chat_stream`/`tool_read_file`/`get_settings`/`set_settings`/`capture_screen`/`active_window`；含含圖片的 `ChatMessage` 格式與 SSE delta 格式 | 3 | S0.1 |
| S0.3 | Node test 骨架 + mock IPC | `tests/` 跑 `node --experimental-strip-types`；`src/ipc/mock.ts` 假 stream / 假 readFile / 假截圖 / 假視窗 | 2 | S0.2 |

### EPIC 1 — Rust 後端能力（Backend track）

| ID | User Story | 驗收條件 | 點 | 相依 |
|----|-----------|---------|----|----|
| S1.1 | 設定存本機（含雙模型槽與觀察偏好） | `settings.rs` get/set app config dir JSON：`api_key`/`chat_model`/`observe_model`/`observe_enabled`/`observe_interval`/`referer`；`lib.rs` 註冊 | 3 | S0.2 |
| S1.2 | 讀本機檔案（第一個工具） | `tools.rs` `tool_read_file(path)`：UTF-8、上限 256KB、錯誤處理 | 3 | S0.2 |
| S1.3 | LLM 串流（支援圖片輸入，key 不外洩） | `llm.rs` `chat_stream(channel, req)`：reqwest 串流打 OpenRouter，訊息可含 image data URL；逐 delta（content + tool_calls 片段）回傳；key 由 settings 讀取不進 JS；401/429/網路錯誤結構化回報 | 8 | S1.1 |
| S1.4 | 螢幕擷取（節流、降尺寸、可暫停） | `capture.rs` `capture_screen()`：用 `xcap` 擷主螢幕→降尺寸(寬≤1024)→JPEG base64 data URL；macOS 螢幕錄製權限偵測/引導；`observe_enabled=false` 時直接拒絕 | 5 | S0.2 |
| S1.5 | 目前視窗查詢（輕量脈絡） | `context.rs` `active_window()`：回傳最前景 app 名 + 視窗標題（用 `active-win-pos-rs` 類套件）；跨平台，失敗回 None | 3 | S0.2 |

### EPIC 2 — 前端 LLM 核心邏輯（LLM-logic track，純函式可 mock）

| ID | User Story | 驗收條件 | 點 | 相依 |
|----|-----------|---------|----|----|
| S2.1 | SSE delta 累積（含分片 tool_call arguments） | `llm/openrouter.ts` 型別 + `accumulateDeltas()`；Node test 覆蓋純文字/分片 tool_call | 5 | S0.3 |
| S2.2 | 模型清單依能力篩選（聊天要 tools／觀察要 image） | `llm/models.ts`：`fetchFreeToolModels()`（`pricing.prompt==="0" && supported_parameters⊇tools`）與 `fetchFreeVisionModels()`（+`architecture.input_modalities⊇image`）；有「tools+image 通吃」的免費模型時標記為推薦；Node test 驗篩選 | 5 | S0.3 |
| S2.3 | function-calling 迴圈 | `llm/loop.ts` `runAgentLoop()`：收 tool_calls→查 registry→執行→回填→再送；無 tool_calls 收斂；Node test 驗一輪工具往返 | 8 | S2.1, S3.1 |

### EPIC 3 — 工具系統（Tool track）

| ID | User Story | 驗收條件 | 點 | 相依 |
|----|-----------|---------|----|----|
| S3.1 | 資料驅動工具 registry（加工具不改迴圈） | `tools/types.ts` `ToolSpec{name,description,parameters,execute}`；`tools/registry.ts` 產 OpenRouter `tools` 格式；MVP 註冊 `read_file`；預留 web/mcp/custom | 5 | S0.2 |

### EPIC 4 — 小夥伴外殼 UI（Companion-shell track）★本次核心改動

| ID | User Story | 驗收條件 | 點 | 相依 |
|----|-----------|---------|----|----|
| S4.1 | 桌面浮動角色視窗 | Tauri 多視窗：`avatar` 視窗 `transparent+decorations:false+alwaysOnTop+skipTaskbar+resizable:false`，小尺寸（~96px），整窗設 `data-tauri-drag-region` 可拖拉；角色有 idle/thinking/talking 動畫狀態（CSS/SVG/Lottie 擇一） | 5 | S0.1 |
| S4.2 | 點角色展開對話氣泡 | 點角色 toggle `chat` 視窗（無邊框氣泡樣式，貼著角色定位）；含訊息列 + Composer（Enter 送/Shift+Enter 換行/送出中可中止 AbortController）+ 串流游標 | 5 | S4.1, S4.5 |
| S4.3 | 工具呼叫透明化 | tool_calls 與 tool 結果渲染成可折疊卡片（名稱+參數+回傳） | 3 | S4.2 |
| S4.4 | 設定頁 | `SettingsDialog`：API key（密碼欄）、聊天模型/觀察模型下拉（S2.2）、觀察開關+頻率+隱私說明；無 key 引導 | 5 | S1.1, S2.2 |
| S4.5 | Zustand stores | `store/chat.ts`（訊息/串流中/中止）、`store/settings.ts`（key/雙模型/觀察偏好）、`store/observation.ts`（目前脈絡/冒泡佇列） | 3 | S0.3 |

### EPIC 5 — 觀察與主動冒泡（Observation track）★新增

| ID | User Story | 驗收條件 | 點 | 相依 |
|----|-----------|---------|----|----|
| S5.1 | 脈絡取樣器 | `observe/sampler.ts`：定期輪詢 `active_window()`（頻繁、便宜）；螢幕截圖僅在「值得一提」或使用者請求時（節流）；`observe_enabled=false` 完全停止 | 5 | S1.4, S1.5, S4.5 |
| S5.2 | 值得一提的判斷（純函式，可測） | `observe/notable.ts`：純函式啟發式（視窗長時間未變/卡關、快速反覆切換、idle→回來等）→回傳是否觸發 + 理由；Node test 用假事件序列驗 | 5 | S0.3 |
| S5.3 | 冒泡把關（省額度、不擾人） | `observe/gate.ts`：先用視窗標題做便宜判斷→必要時才截圖+視覺模型問「有沒有值得說的？沒有就沉默」；冷卻/速率上限；輸出短訊息或靜默 | 5 | S5.1, S5.2, S2.1 |
| S5.4 | 冒泡 UI + 帶脈絡對話 | 角色旁彈出小語音氣泡（可自動消失/點擊展開成完整對話）；使用者主動開對話時，最近觀察脈絡自動注入 system/context | 3 | S5.3, S4.2 |

### EPIC 6 — 整合與驗收（Integration，收斂 track）

| ID | User Story | 驗收條件 | 點 | 相依 |
|----|-----------|---------|----|----|
| S6.1 | 純聊天可用（Sprint 1 里程碑一部分） | 貼 key→選模型→點角色→問一句→逐字串流 | 3 | S1.3, S2.1, S4.2 |
| S6.2 | 讀檔迴圈打通（Sprint 1 完成） | 「讀取 `<路徑>` 並摘要」→出現 read_file 卡片→據內容回覆；錯 key 顯示 401、讀不存在檔能處理 | 5 | S6.1, S2.3, S3.1, S1.2 |
| S6.3 | 觀察冒泡打通（Sprint 2 完成） | 開啟觀察→切換 app→角色反映脈絡；觸發值得一提事件→冒泡出現；點冒泡→帶著剛觀察到的脈絡對話；關閉觀察→完全停止、無截圖 | 5 | S6.2, S5.4 |

**總點數 ≈ 111。Sprint 1（EPIC 0–4 + S6.1/6.2）≈ 68；Sprint 2（EPIC 5 + S6.3）≈ 23。**

---

## 隱私與權限（新方向的硬約束）

- 觀察**預設關閉**，需使用者在設定頁明確開啟；角色上恆有「暫停觀察」快捷（一鍵停）。
- 螢幕截圖需 macOS 螢幕錄製權限（TCC）；首次引導、被拒時退回「只用視窗標題」模式。
- 截圖只在記憶體處理→送出→即丟，不落地存檔；預設降尺寸壓縮以省 token 也降敏感度。
- 送往 OpenRouter 的一切都在觀察開啟時才發生；關閉即無任何擷取/上傳。

---

## 多工 / 平行處理規劃

### 相依圖（→ 表示「必須先完成」）

```
                     ┌─> S1.1 ─> S1.3 ───────────────┐
S0.1 ─> S0.2 ─> S0.3 ┼─> S1.2 ─────────┐             │
        (契約凍結)    ├─> S1.4, S1.5 ───┼──> S5.1 ─┐  │
                     ├─> S2.1 ─┐        │          ├─> S5.3 ─> S5.4 ─┐
                     ├─> S2.2 ─┤        │  S5.2 ───┘                 │
                     ├─> S3.1 ─┼> S2.3 ─┼──────────────> S6.1,S6.2 ──┼─> S6.3
                     └─> S4.5 ─> S4.1 ─> S4.2 ─> S4.3 ; S4.4 ────────┘  (Sprint2)
                                                        (Sprint1 里程碑)
```

### 同步關卡

- **Gate A — 契約凍結（S0.2）**：`ipc/contract.ts` 一鎖定，五條軌道靠 mock 平行。
- **Gate B — Sprint 1 里程碑（S6.2）**：小夥伴能點開、聊天、跑工具迴圈。
- **Gate C — Sprint 2（S6.3）**：觀察+冒泡接上真截圖/視窗。

### 可平行的工作軌道（Gate A 之後）

| 軌道 | 負責 Story | 特性 | 建議 agent |
|------|-----------|------|-----------|
| **T1 Backend（Rust）** | S1.1→S1.3；S1.2；S1.4；S1.5 | 純 Rust；S1.3 串流、S1.4 截圖權限最重 | `feature-dev:code-architect` 起手 |
| **T2 LLM-logic（TS 純函式）** | S2.1, S2.2 → S2.3 | 純函式+Node test，離線可驗，最先綠燈 | 獨立 agent |
| **T3 Tools** | S3.1 | 小而關鍵（S2.3 相依），優先交付 | 併入 T2 或獨立 |
| **T4 Companion-shell UI** | S4.5→S4.1→S4.2→S4.3；S4.4 | Tauri 多視窗/透明置頂為新風險點，宜早做 spike | 獨立 agent + `frontend-design` |
| **T5 Observation** | S5.2（純函式先行）→ S5.1→S5.3→S5.4 | S5.2 可純函式先綠燈；其餘待 T1 截圖/視窗與 T4 store | 獨立 agent（Sprint 2 主力） |

**排程建議**：
1. **Wave 0（序列）**：S0.1→S0.2→S0.3。唯一不可平行的關鍵路徑。
2. **Wave 1（Sprint 1，5 軌並行）**：T1/T2/T3/T4 全開；T5 先做 S5.2 純函式。優先 spike **S4.1 透明置頂多視窗**（最高不確定性）與 **S1.4 截圖權限**。
3. **Wave 2（Sprint 1 收斂）**：S6.1→S6.2。
4. **Wave 3（Sprint 2）**：S5.1→S5.3→S5.4→S6.3。
5. **關鍵路徑**：`S0.1→S0.2→S1.1→S1.3→S6.1→S6.2`（Backend 串流最長鏈）；UX 新風險在 `S4.1`（透明置頂多視窗）、`S1.4`（螢幕權限），兩者盡早 spike。

### 分派注意
- 平行 agent 用 worktree 隔離；`ipc/contract.ts` 視為唯讀共享介面，變更需同步全軌道。
- T2/T3/S5.2 純函式+Node test，最適合平行 agent 自動化驗收、回報綠燈即整合。

---

## 建置注意（exFAT 陷阱，來自記憶）

Transcend 是 exFAT，Tauri build 會被 `._` 檔卡住。dev 與 build 都設 `CARGO_TARGET_DIR=$HOME/.sage-target`（APFS），寫進 npm scripts 或 `.env`。

## 驗證方式（E2E）

- **純函式測試**：`loop.ts`、`openrouter.ts`（delta 累積）、`models.ts`（tools/vision 篩選）、`observe/notable.ts`（值得一提啟發式）。
- **手動 E2E**：`CARGO_TARGET_DIR=$HOME/.sage-target npm run tauri dev` →
  1. 角色漂在桌面、可拖拉、置頂於其他視窗之上。
  2. 設定頁貼 key、選聊天+觀察模型；點角色開氣泡，純聊天串流。
  3. 叫它讀檔摘要 → 出現 read_file 卡片 → 據內容回覆。
  4. 開啟觀察 → 切到別的 app → 觸發值得一提事件 → 角色冒泡；點冒泡帶脈絡續聊。
  5. 關閉觀察/按暫停 → 確認不再截圖上傳（可用網路面板或 log 佐證）。

## 範圍界線

- Sprint 1 只含 `read_file`；web/MCP/自訂工具留待後續。
- 觀察 MVP 只做視窗標題 + 截圖兩訊號；不做鍵盤/滑鼠側錄、不做對話持久化。
