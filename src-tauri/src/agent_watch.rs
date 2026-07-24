// Observe the user's *own* coding-agent sessions (Claude Code / Codex) so the
// companion can react to what they're doing in the terminal — what's running,
// what just finished, what was said, which tool ran. Read-only and best-effort:
// we tail the transcript JSONL each CLI already writes to disk (no wrapping, no
// extra process), normalize the tail into one `AgentActivity`, and let the
// existing observe gate decide whether to speak.
//
//   Claude Code: ~/.claude/projects/<enc-cwd>/<session-uuid>.jsonl
//                (top-level type:"user"|"assistant", message.content blocks)
//   Codex:       ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
//                (type:"event_msg" payloads; session_meta carries the system
//                 prompt and is skipped)
//
// Precise "streaming now / waiting for permission" comes from a Claude hook
// inbox (S-agent phase 3); the transcript alone gives content + tool + a coarse
// running/idle guess from recency. Everything user-visible passes
// privacy::sanitize_text and hard length caps before it leaves Rust. Disabled
// (observe_agents off) ⇒ nothing under ~/.claude or ~/.codex is ever read.
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// Mirrors contract.ts `AgentActivity` (snake_case).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AgentActivity {
    /// "claude" | "codex" — which CLI this reflects.
    pub source: String,
    /// Session identifier (transcript filename stem) — lets the frontend tell
    /// one session's activity from the next.
    pub session: String,
    /// "running" | "idle" | "waiting_permission".
    pub state: String,
    /// Recent turn text (user prompts + assistant replies), oldest→newest,
    /// sanitized and length-capped.
    pub texts: Vec<String>,
    /// Last tool action, human-readable (e.g. "Read /path" / "shell: pwd"), or None.
    pub tool: Option<String>,
    /// Transcript mtime, epoch milliseconds — drives the recency state guess and
    /// lets the caller ignore stale sessions.
    pub updated_at: u64,
}

/// How many recent text fragments to surface.
const MAX_TEXTS: usize = 6;
/// Per-fragment char cap (a sentence or two is plenty of context for the gate).
const MAX_TEXT_CHARS: usize = 280;
/// How much of the transcript tail to read — the last turn or two, never the
/// whole (potentially multi-MB) file.
const TAIL_BYTES: u64 = 64 * 1024;
/// A transcript touched this recently, with no clearer signal, is treated as an
/// in-progress turn.
const RECENT_MS: u64 = 8_000;

// ---------------------------------------------------------------------------
// Pure parsing (no I/O — unit-tested directly)
// ---------------------------------------------------------------------------

/// What the transcript tail yielded. `running_hint` is Some when the format
/// tells us unambiguously (Codex task markers), None when only recency can
/// guess (Claude has no explicit turn-boundary marker in the transcript).
#[derive(Debug, Default, PartialEq)]
struct Parsed {
    texts: Vec<String>,
    tool: Option<String>,
    running_hint: Option<bool>,
}

/// Cap a string to `MAX_TEXT_CHARS` on a char boundary, collapsing whitespace so
/// a multi-line prompt reads as one line.
fn clip(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let sanitized = crate::privacy::sanitize_text(&collapsed);
    if sanitized.chars().count() <= MAX_TEXT_CHARS {
        sanitized
    } else {
        let mut out: String = sanitized.chars().take(MAX_TEXT_CHARS).collect();
        out.push('…');
        out
    }
}

/// Plain text of a Claude `message.content` (a string, or the "text" parts of a
/// block array). Returns empty when the content is only tool_use/tool_result/
/// thinking — those aren't turn text.
fn claude_message_text(content: &Value) -> String {
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    let mut out = String::new();
    if let Some(parts) = content.as_array() {
        for part in parts {
            if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                    if !out.is_empty() {
                        out.push(' ');
                    }
                    out.push_str(t);
                }
            }
        }
    }
    out
}

/// Does this content array carry a tool_result block? (A user line that is just
/// a tool result is not a fresh prompt.)
fn claude_has_tool_result(content: &Value) -> bool {
    content
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .any(|p| p.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
        })
        .unwrap_or(false)
}

/// A one-line label for a Claude tool_use block ("Read /path", "Bash: git …").
fn claude_tool_label(block: &Value) -> Option<String> {
    let name = block.get("name").and_then(|n| n.as_str())?;
    let input = block.get("input");
    let arg = input.and_then(|i| {
        for key in ["file_path", "path", "command", "pattern", "url", "query"] {
            if let Some(v) = i.get(key).and_then(|v| v.as_str()) {
                return Some(v.to_string());
            }
        }
        None
    });
    Some(match arg {
        Some(a) => format!("{name}: {a}"),
        None => name.to_string(),
    })
}

/// Is a Claude line meta noise (mode markers, snapshots, injected caveats,
/// `isMeta`) rather than real turn content?
fn claude_is_meta(v: &Value) -> bool {
    if v.get("isMeta").and_then(|m| m.as_bool()) == Some(true) {
        return true;
    }
    // A user line whose content is a local-command caveat / slash-command echo.
    if let Some(s) = v.pointer("/message/content").and_then(|c| c.as_str()) {
        if s.contains("<local-command-caveat>")
            || s.contains("<command-name>")
            || s.contains("<command-message>")
        {
            return true;
        }
    }
    false
}

/// Parse a Claude transcript tail. Walks lines oldest→newest, keeping the last
/// few turn texts and the last tool; `running_hint` stays None (recency decides).
fn parse_claude(tail: &str) -> Parsed {
    let mut texts: Vec<String> = Vec::new();
    let mut tool: Option<String> = None;

    for line in tail.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue, // a truncated first line, or non-JSON — skip
        };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("assistant") => {
                if let Some(content) = v.pointer("/message/content") {
                    let text = claude_message_text(content);
                    if !text.trim().is_empty() {
                        texts.push(format!("助手：{}", clip(&text)));
                    }
                    if let Some(parts) = content.as_array() {
                        for block in parts {
                            if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                if let Some(label) = claude_tool_label(block) {
                                    tool = Some(clip(&label));
                                }
                            }
                        }
                    }
                }
            }
            Some("user") => {
                if claude_is_meta(&v) {
                    continue;
                }
                let content = match v.pointer("/message/content") {
                    Some(c) => c,
                    None => continue,
                };
                if claude_has_tool_result(content) {
                    continue; // a tool result, not a prompt
                }
                let text = claude_message_text(content);
                if !text.trim().is_empty() {
                    texts.push(format!("使用者：{}", clip(&text)));
                }
            }
            _ => {} // mode / thinking / file-history / system / … — ignore
        }
    }

    keep_last(&mut texts);
    Parsed {
        texts,
        tool,
        running_hint: None,
    }
}

/// Parse a Codex rollout tail. `event_msg` payloads carry clean turn text and
/// unambiguous task markers, so `running_hint` is decisive here.
fn parse_codex(tail: &str) -> Parsed {
    let mut texts: Vec<String> = Vec::new();
    let mut tool: Option<String> = None;
    let mut running: Option<bool> = None;

    for line in tail.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        // Only event_msg carries the clean, deduped view; session_meta (system
        // prompt) and response_item (developer/permissions noise) are skipped.
        if v.get("type").and_then(|t| t.as_str()) != Some("event_msg") {
            continue;
        }
        let payload = match v.get("payload") {
            Some(p) => p,
            None => continue,
        };
        match payload.get("type").and_then(|t| t.as_str()) {
            Some("user_message") => {
                if let Some(m) = payload.get("message").and_then(|m| m.as_str()) {
                    if !m.trim().is_empty() {
                        texts.push(format!("使用者：{}", clip(m)));
                    }
                }
            }
            Some("agent_message") => {
                if let Some(m) = payload.get("message").and_then(|m| m.as_str()) {
                    if !m.trim().is_empty() {
                        texts.push(format!("助手：{}", clip(m)));
                    }
                }
            }
            Some("exec_command_end") => {
                tool = Some(clip(&codex_exec_label(payload)));
            }
            Some("task_started") => running = Some(true),
            Some("task_complete") | Some("turn_aborted") => running = Some(false),
            _ => {}
        }
    }

    keep_last(&mut texts);
    Parsed {
        texts,
        tool,
        running_hint: running,
    }
}

/// Best label for a Codex exec_command_end: the parsed command, else the raw
/// command array's last element ("/bin/zsh -lc <cmd>" → the cmd).
fn codex_exec_label(payload: &Value) -> String {
    if let Some(cmd) = payload
        .pointer("/parsed_cmd/0/cmd")
        .and_then(|c| c.as_str())
    {
        return format!("shell: {cmd}");
    }
    if let Some(arr) = payload.get("command").and_then(|c| c.as_array()) {
        if let Some(last) = arr.last().and_then(|v| v.as_str()) {
            return format!("shell: {last}");
        }
    }
    "shell".to_string()
}

fn keep_last(texts: &mut Vec<String>) {
    if texts.len() > MAX_TEXTS {
        texts.drain(0..texts.len() - MAX_TEXTS);
    }
}

/// Decide the surfaced state from the format hint, the transcript's age, and an
/// authoritative hook signal (Claude inbox; None until phase 3).
fn derive_state(running_hint: Option<bool>, age_ms: u64, inbox: Option<&str>) -> String {
    if let Some(state) = inbox {
        return state.to_string();
    }
    match running_hint {
        Some(true) => "running".into(),
        Some(false) => "idle".into(),
        None => {
            if age_ms < RECENT_MS {
                "running".into()
            } else {
                "idle".into()
            }
        }
    }
}

// ---------------------------------------------------------------------------
// I/O: find the newest transcript, read its tail
// ---------------------------------------------------------------------------

struct Candidate {
    source: &'static str,
    path: PathBuf,
    mtime_ms: u64,
}

fn mtime_ms(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let dur = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(dur.as_millis() as u64)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Newest `*.jsonl` directly inside any subdirectory of `~/.claude/projects/`.
fn newest_claude(home: &Path) -> Option<Candidate> {
    let root = home.join(".claude").join("projects");
    let mut best: Option<Candidate> = None;
    for project in std::fs::read_dir(&root).ok()?.flatten() {
        if !project.path().is_dir() {
            continue;
        }
        let entries = match std::fs::read_dir(project.path()) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            consider(&mut best, "claude", path);
        }
    }
    best
}

/// Newest `rollout-*.jsonl` under `~/.codex/sessions/` (YYYY/MM/DD nesting).
fn newest_codex(home: &Path) -> Option<Candidate> {
    let root = home.join(".codex").join("sessions");
    let mut best: Option<Candidate> = None;
    walk_rollouts(&root, 0, &mut best);
    best
}

/// Bounded recursive walk (sessions/YYYY/MM/DD ⇒ depth 3) collecting the newest
/// rollout file. The depth cap keeps a pathological tree from being expensive.
fn walk_rollouts(dir: &Path, depth: usize, best: &mut Option<Candidate>) {
    if depth > 4 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_rollouts(&path, depth + 1, best);
        } else {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with("rollout-") && name.ends_with(".jsonl") {
                consider(best, "codex", path);
            }
        }
    }
}

/// Keep `path` in `best` if it's newer than the current pick.
fn consider(best: &mut Option<Candidate>, source: &'static str, path: PathBuf) {
    let mtime = match mtime_ms(&path) {
        Some(m) => m,
        None => return,
    };
    if best.as_ref().map(|b| mtime > b.mtime_ms).unwrap_or(true) {
        *best = Some(Candidate {
            source,
            path,
            mtime_ms: mtime,
        });
    }
}

/// Read the last `TAIL_BYTES` of a file as lossy UTF-8, dropping the first
/// (possibly partial) line when we didn't start at the beginning.
fn read_tail(path: &Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let (seek, drop_first) = if len > TAIL_BYTES {
        (len - TAIL_BYTES, true)
    } else {
        (0, false)
    };
    file.seek(SeekFrom::Start(seek)).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    if drop_first {
        Some(text.split_once('\n').map(|x| x.1).unwrap_or("").to_string())
    } else {
        Some(text)
    }
}

// ---------------------------------------------------------------------------
// Claude hook inbox (file-drop): precise state, no polling latency
// ---------------------------------------------------------------------------
//
// A Sage-owned hook appended to ~/.claude/settings.json pipes each hook event's
// stdin (one JSON line) into ~/.sage/agent-events.jsonl. We tail that inbox for
// the newest event of the *current* session and map it to an authoritative
// state — the transcript can't tell "streaming now" from "waiting for you", the
// hook can. Codex has no comparable per-event hook, so this is Claude-only.

/// Marks Sage's own hook entry so we can find/update/remove it without touching
/// entries other tools (e.g. a user's existing setup) added to the same arrays.
const HOOK_MARKER: &str = "sage-agent-hook";
/// Inbox path, relative to home. Kept in sync with the hook command below.
const INBOX_REL: &str = ".sage/agent-events.jsonl";

/// The shell command Sage installs. Shell-agnostic ($HOME, tr, echo are POSIX):
/// collapse the (possibly pretty-printed) hook JSON to one physical line, then
/// terminate it — so the inbox stays valid JSONL. Best-effort: every failure is
/// swallowed so a hook never disrupts the user's Claude session.
fn hook_command() -> String {
    format!(
        "mkdir -p \"$HOME/.sage\" 2>/dev/null; {{ tr -d '\\n'; echo; }} >> \"$HOME/{INBOX_REL}\" 2>/dev/null # {HOOK_MARKER}"
    )
}

/// Claude hook events Sage listens on, and the state each implies.
const HOOK_EVENTS: &[&str] = &["UserPromptSubmit", "PostToolUse", "Notification", "Stop"];

fn hook_event_state(event: &str) -> Option<&'static str> {
    match event {
        "UserPromptSubmit" | "PostToolUse" | "PreToolUse" => Some("running"),
        "Notification" => Some("waiting_permission"),
        "Stop" | "SubagentStop" => Some("idle"),
        _ => None,
    }
}

/// The state implied by the newest inbox event belonging to `session`, or None
/// when the inbox is absent/empty or has nothing for this session.
fn read_inbox_state(home: &Path, session: &str) -> Option<String> {
    let tail = read_tail(&home.join(INBOX_REL))?;
    let mut latest: Option<String> = None;
    for line in tail.lines() {
        let v: Value = match serde_json::from_str(line.trim()) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("session_id").and_then(|s| s.as_str()) != Some(session) {
            continue;
        }
        if let Some(event) = v.get("hook_event_name").and_then(|e| e.as_str()) {
            if let Some(state) = hook_event_state(event) {
                latest = Some(state.to_string()); // keep the last matching line
            }
        }
    }
    latest
}

/// Ensure ~/.claude/settings.json has (enabled) or lacks (disabled) Sage's hook
/// entry in each `HOOK_EVENTS` array — additive and idempotent, touching only
/// the marked entry so any other tool's hooks are preserved. Called on every
/// settings save; writes only when something actually changed. Under WSL the
/// hook is installed into the WSL home's `.claude/settings.json` so the coding
/// agent running inside WSL actually loads it.
pub fn reconcile_claude_hook(
    app: &tauri::AppHandle,
    settings: &crate::settings::Settings,
) -> Result<(), String> {
    let enabled = settings.observe_agents;
    let home = observe_home(app, settings).ok_or("could not resolve home directory")?;
    let path = home.join(".claude").join("settings.json");

    // No settings file and nothing to add ⇒ nothing to do. When enabling we
    // create it (an empty object is a valid Claude settings file).
    let existing = std::fs::read_to_string(&path).ok();
    if existing.is_none() && !enabled {
        return Ok(());
    }
    let mut root: Value = existing
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !root.is_object() {
        return Err("~/.claude/settings.json is not a JSON object".into());
    }

    let changed = apply_hook(&mut root, enabled);
    if !changed {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Mutate a parsed settings object to add/remove Sage's hook entry. Pure over
/// the Value (no I/O) so it's unit-tested directly. Returns whether it changed.
fn apply_hook(root: &mut Value, enabled: bool) -> bool {
    let obj = match root.as_object_mut() {
        Some(o) => o,
        None => return false,
    };
    // hooks: {} — created only when enabling.
    if !obj.contains_key("hooks") {
        if !enabled {
            return false;
        }
        obj.insert("hooks".into(), serde_json::json!({}));
    }
    let hooks = match obj.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        Some(h) => h,
        None => return false,
    };

    let is_ours = |group: &Value| -> bool {
        group
            .get("hooks")
            .and_then(|h| h.as_array())
            .map(|arr| {
                arr.iter().any(|h| {
                    h.get("command")
                        .and_then(|c| c.as_str())
                        .map(|c| c.contains(HOOK_MARKER))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    };

    let mut changed = false;
    for event in HOOK_EVENTS {
        let arr = hooks
            .entry((*event).to_string())
            .or_insert_with(|| Value::Array(vec![]));
        let arr = match arr.as_array_mut() {
            Some(a) => a,
            None => continue,
        };
        let has_ours = arr.iter().any(is_ours);
        if enabled && !has_ours {
            arr.push(serde_json::json!({
                "hooks": [ { "type": "command", "command": hook_command() } ]
            }));
            changed = true;
        } else if !enabled && has_ours {
            arr.retain(|g| !is_ours(g));
            changed = true;
        }
    }
    changed
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/// The home directory whose `.claude` / `.codex` / `.sage` trees Sage observes.
/// Normally the OS home. When `agent_cli_use_wsl` is on (Windows only), the
/// coding agent runs *inside* WSL and writes its transcripts to the WSL home, so
/// we resolve that distro's `$HOME` as a `\\wsl.localhost\...` UNC path Sage can
/// read directly — the same bridging the agent-CLI backend already does.
fn observe_home(app: &tauri::AppHandle, settings: &crate::settings::Settings) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if settings.agent_cli_use_wsl {
            return wsl_home(&settings.agent_cli_wsl_distro);
        }
    }
    #[cfg(not(windows))]
    let _ = settings;
    app.path().home_dir().ok()
}

/// The WSL distro's `$HOME` as a Windows UNC path (e.g.
/// `\\wsl.localhost\Ubuntu\home\me`), or None if WSL can't be reached. Resolved
/// via `wsl.exe -- sh -c 'wslpath -w "$HOME"'` and cached per distro — the
/// activity poller calls this often and spawning wsl.exe each time is wasteful.
#[cfg(windows)]
fn wsl_home(distro: &str) -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    use std::sync::Mutex;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    static CACHE: Mutex<Option<(String, PathBuf)>> = Mutex::new(None);

    if let Ok(cache) = CACHE.lock() {
        if let Some((d, p)) = cache.as_ref() {
            if d == distro {
                return Some(p.clone());
            }
        }
    }

    let mut cmd = std::process::Command::new("wsl.exe");
    if !distro.is_empty() {
        cmd.arg("-d").arg(distro);
    }
    cmd.arg("--").arg("sh").arg("-c").arg("wslpath -w \"$HOME\"");
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return None;
    }
    let pb = PathBuf::from(path);
    if let Ok(mut cache) = CACHE.lock() {
        *cache = Some((distro.to_string(), pb.clone()));
    }
    Some(pb)
}

/// Current coding-agent activity, or None when the feature is off, no session
/// exists, or nothing could be read. Never errors — a companion signal must
/// degrade to silence, never to a surfaced failure.
#[tauri::command]
pub fn agent_activity(app: tauri::AppHandle) -> Option<AgentActivity> {
    let settings = crate::settings::load(&app);
    if !settings.observe_agents {
        return None;
    }
    let home = observe_home(&app, &settings)?;
    activity_from_home(&home)
}

/// Home-relative core, split out so tests can drive it against a temp dir.
fn activity_from_home(home: &Path) -> Option<AgentActivity> {
    let candidate = [newest_claude(home), newest_codex(home)]
        .into_iter()
        .flatten()
        .max_by_key(|c| c.mtime_ms)?;

    let tail = read_tail(&candidate.path)?;
    let parsed = match candidate.source {
        "codex" => parse_codex(&tail),
        _ => parse_claude(&tail),
    };

    let session = candidate
        .path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    // The Claude hook inbox gives an authoritative state for the current
    // session (Codex has no such hook, so it stays on the recency guess).
    let inbox = if candidate.source == "claude" {
        read_inbox_state(home, &session)
    } else {
        None
    };
    let age = now_ms().saturating_sub(candidate.mtime_ms);
    let state = derive_state(parsed.running_hint, age, inbox.as_deref());

    Some(AgentActivity {
        source: candidate.source.to_string(),
        session,
        state,
        texts: parsed.texts,
        tool: parsed.tool,
        updated_at: candidate.mtime_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_extracts_prompt_reply_and_tool() {
        let tail = concat!(
            r#"{"type":"user","message":{"role":"user","content":"fix the build"}}"#,
            "\n",
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"On it."},{"type":"tool_use","name":"Read","input":{"file_path":"/tmp/x.rs"}}]}}"#,
            "\n",
        );
        let p = parse_claude(tail);
        assert_eq!(p.texts, vec!["使用者：fix the build", "助手：On it."]);
        assert_eq!(p.tool.as_deref(), Some("Read: /tmp/x.rs"));
        assert_eq!(p.running_hint, None);
    }

    #[test]
    fn claude_skips_meta_thinking_and_tool_results() {
        let tail = concat!(
            r#"{"type":"mode","mode":"normal"}"#,
            "\n",
            r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"internal"}}"#,
            "\n",
            r#"{"type":"user","message":{"role":"user","content":"<local-command-caveat>x</local-command-caveat>"}}"#,
            "\n",
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"}]}}"#,
            "\n",
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":"ok"}]}}"#,
            "\n",
            r#"{"type":"user","message":{"role":"user","content":"real question"}}"#,
            "\n",
        );
        let p = parse_claude(tail);
        assert_eq!(p.texts, vec!["使用者：real question"]);
        assert_eq!(p.tool, None);
    }

    #[test]
    fn codex_extracts_text_tool_and_running_state() {
        let tail = concat!(
            r#"{"type":"session_meta","payload":{"base_instructions":{"text":"SECRET SYSTEM PROMPT"}}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"t"}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"why did build fail"}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"agent_message","message":"Let me check."}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"exec_command_end","command":["/bin/zsh","-lc","pwd"],"parsed_cmd":[{"type":"unknown","cmd":"pwd"}]}}"#,
            "\n",
        );
        let p = parse_codex(tail);
        assert_eq!(p.texts, vec!["使用者：why did build fail", "助手：Let me check."]);
        assert_eq!(p.tool.as_deref(), Some("shell: pwd"));
        assert_eq!(p.running_hint, Some(true));
        // The session-meta system prompt must never leak into texts.
        assert!(!p.texts.iter().any(|t| t.contains("SECRET")));
    }

    #[test]
    fn codex_task_complete_is_idle() {
        let tail = concat!(
            r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"t"}}"#,
            "\n",
            r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"t"}}"#,
            "\n",
        );
        assert_eq!(parse_codex(tail).running_hint, Some(false));
    }

    #[test]
    fn clip_sanitizes_and_caps() {
        let long = "a ".repeat(400);
        let out = clip(&long);
        assert!(out.chars().count() <= MAX_TEXT_CHARS + 1); // +1 for the ellipsis
        // Sanitization (emails) applies to transcript text too.
        assert_eq!(clip("mail me alice@example.com now"), "mail me *** now");
    }

    #[test]
    fn derive_state_precedence() {
        // Inbox (hook) wins over everything.
        assert_eq!(derive_state(Some(false), 0, Some("waiting_permission")), "waiting_permission");
        // Explicit hint next.
        assert_eq!(derive_state(Some(true), 99_999, None), "running");
        assert_eq!(derive_state(Some(false), 0, None), "idle");
        // Fall back to recency.
        assert_eq!(derive_state(None, 1_000, None), "running");
        assert_eq!(derive_state(None, 60_000, None), "idle");
    }

    #[test]
    fn inbox_maps_latest_matching_session_event() {
        let dir = std::env::temp_dir().join(format!("sage-inbox-{}", now_ms()));
        let sage = dir.join(".sage");
        std::fs::create_dir_all(&sage).unwrap();
        let inbox = concat!(
            r#"{"session_id":"A","hook_event_name":"UserPromptSubmit"}"#,
            "\n",
            r#"{"session_id":"B","hook_event_name":"Stop"}"#,
            "\n",
            r#"{"session_id":"A","hook_event_name":"Notification"}"#,
            "\n",
        );
        std::fs::write(sage.join("agent-events.jsonl"), inbox).unwrap();

        // Session A's last event is Notification ⇒ waiting; B's is Stop ⇒ idle.
        assert_eq!(read_inbox_state(&dir, "A").as_deref(), Some("waiting_permission"));
        assert_eq!(read_inbox_state(&dir, "B").as_deref(), Some("idle"));
        // A session with no inbox line ⇒ None.
        assert_eq!(read_inbox_state(&dir, "C"), None);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn hook_install_is_additive_and_idempotent() {
        // A pre-existing (foreign) hook entry must survive install + uninstall.
        let mut root = serde_json::json!({
            "model": "opus",
            "hooks": {
                "Stop": [ { "hooks": [ { "type": "command", "command": "curl other-tool" } ] } ]
            }
        });

        assert!(apply_hook(&mut root, true));
        // Second install is a no-op (idempotent).
        assert!(!apply_hook(&mut root, true));

        // Every listened event now has exactly one Sage entry.
        for event in HOOK_EVENTS {
            let arr = root["hooks"][event].as_array().unwrap();
            let ours = arr
                .iter()
                .filter(|g| {
                    g["hooks"][0]["command"]
                        .as_str()
                        .unwrap_or("")
                        .contains(HOOK_MARKER)
                })
                .count();
            assert_eq!(ours, 1, "{event} should have one Sage hook");
        }
        // The foreign Stop entry is still there alongside Sage's.
        assert_eq!(root["hooks"]["Stop"].as_array().unwrap().len(), 2);
        // Untouched keys survive.
        assert_eq!(root["model"], "opus");

        // Uninstall removes only Sage's entries; the foreign one remains.
        assert!(apply_hook(&mut root, false));
        assert!(!apply_hook(&mut root, false)); // idempotent
        assert_eq!(root["hooks"]["Stop"].as_array().unwrap().len(), 1);
        assert_eq!(root["hooks"]["Stop"][0]["hooks"][0]["command"], "curl other-tool");
        for event in HOOK_EVENTS {
            let arr = root["hooks"][event].as_array().unwrap();
            assert!(!arr.iter().any(|g| g["hooks"][0]["command"]
                .as_str()
                .unwrap_or("")
                .contains(HOOK_MARKER)));
        }
    }

    #[test]
    fn hook_disable_on_empty_settings_is_noop() {
        let mut root = serde_json::json!({});
        assert!(!apply_hook(&mut root, false)); // nothing to remove, no hooks key created
        assert!(root.get("hooks").is_none());
    }

    #[test]
    fn inbox_state_overrides_recency_in_activity() {
        let dir = std::env::temp_dir().join(format!("sage-inbox-act-{}", now_ms()));
        let proj = dir.join(".claude").join("projects").join("p");
        let sage = dir.join(".sage");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::create_dir_all(&sage).unwrap();
        std::fs::write(
            proj.join("sess-9.jsonl"),
            r#"{"type":"user","message":{"role":"user","content":"go"}}"#,
        )
        .unwrap();
        // Fresh mtime would guess "running"; the hook says the turn ended.
        std::fs::write(
            sage.join("agent-events.jsonl"),
            "{\"session_id\":\"sess-9\",\"hook_event_name\":\"Stop\"}\n",
        )
        .unwrap();

        let act = activity_from_home(&dir).expect("activity");
        assert_eq!(act.source, "claude");
        assert_eq!(act.state, "idle"); // inbox won over recency

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn newest_across_sources_and_tail_parse() {
        let dir = std::env::temp_dir().join(format!("sage-agentwatch-{}", now_ms()));
        let proj = dir.join(".claude").join("projects").join("p");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(
            proj.join("sess-1.jsonl"),
            r#"{"type":"user","message":{"role":"user","content":"hello there"}}"#,
        )
        .unwrap();

        let act = activity_from_home(&dir).expect("some activity");
        assert_eq!(act.source, "claude");
        assert_eq!(act.session, "sess-1");
        assert_eq!(act.texts, vec!["使用者：hello there"]);

        std::fs::remove_dir_all(&dir).ok();
    }
}
