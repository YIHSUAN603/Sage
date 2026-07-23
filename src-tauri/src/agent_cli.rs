// Agent-CLI backend: stream one turn from a locally installed agent CLI
// (`claude -p` or `codex exec`) instead of OpenRouter. Each CLI runs its own
// read-only tool loop and speaks its own JSON event stream; a per-CLI adapter
// (claude.rs / codex.rs) maps that stream onto the shared AgentStreamEvent shape
// mirrored in src/ipc/contract.ts. Adding a CLI = a new adapter + one match arm.
mod claude;
mod codex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::Stdio;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::llm::{ChatMessage, StreamErrorKind};
use crate::settings;

// ---------------------------------------------------------------------------
// Wire types (contract.ts: AgentStreamEvent / AgentRequest)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentStreamEvent {
    Delta {
        content: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        id: String,
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
    Done {
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
    Error {
        kind: StreamErrorKind,
        message: String,
    },
}

#[derive(Debug, Deserialize)]
pub struct AgentRequest {
    pub cli: String,
    pub messages: Vec<ChatMessage>,
    /// "chat" | "observe" — observe runs tool-free + terse.
    pub purpose: String,
    /// Model override for the CLI; empty ⇒ the CLI's own default.
    #[serde(default)]
    pub model: String,
    /// Tool permission tier: "read_only" | "edit" | "full". Never deserialized —
    /// the webview can't grant itself tools; `agent_stream` injects it from
    /// settings, and only for chat (observe is pinned to read_only).
    #[serde(skip)]
    pub permission: String,
}

/// Windows spawns every console child of a GUI app in a fresh console window,
/// so each claude/codex call flashes (or leaves behind) a terminal. Suppress it.
#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn hide_console(_cmd: &mut Command) {}

/// Clamp a stored permission string to a known tier (anything else ⇒ read_only).
fn sanitize_permission(raw: &str) -> String {
    match raw {
        "edit" | "full" => raw.to_string(),
        _ => "read_only".to_string(),
    }
}

/// What an adapter wants launched: extra argv (after the binary) and an optional
/// stdin payload (the conversation, as that CLI expects it).
pub struct Spawn {
    pub args: Vec<String>,
    pub stdin: Option<String>,
}

/// One agent CLI. Pure, testable: `build` decides how to invoke it, `parse_line`
/// maps one stdout line to zero or more events. No I/O lives here.
trait Adapter {
    /// Binary name resolved on PATH when settings.agent_cli_path is empty.
    fn default_bin(&self) -> &'static str;
    fn build(&self, req: &AgentRequest) -> Spawn;
    fn parse_line(&self, line: &str) -> Vec<AgentStreamEvent>;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn agent_stream(
    app: tauri::AppHandle,
    channel: Channel<AgentStreamEvent>,
    req: AgentRequest,
) -> Result<(), String> {
    let settings = settings::load(&app);
    let mut req = req;
    req.permission = if req.purpose == "chat" {
        sanitize_permission(&settings.agent_cli_permission)
    } else {
        "read_only".to_string()
    };
    let adapter: Box<dyn Adapter + Send + Sync> = match req.cli.as_str() {
        "claude" => Box::new(claude::Claude),
        "codex" => Box::new(codex::Codex),
        other => {
            emit_error(
                &channel,
                StreamErrorKind::Api,
                format!("unsupported agent CLI: {other}"),
            );
            return Ok(());
        }
    };
    run(adapter.as_ref(), &settings.agent_cli_path, &req, &channel).await;
    Ok(())
}

/// Probe a CLI by running `<bin> --version`. Powers the Settings "detected /
/// not found" note so a missing binary is caught before the user tries to chat.
#[tauri::command]
pub async fn check_agent_cli(cli: String, path: String) -> Result<String, String> {
    let bin = if !path.is_empty() {
        path
    } else {
        match cli.as_str() {
            "claude" => "claude".to_string(),
            "codex" => "codex".to_string(),
            other => return Err(format!("unknown agent CLI: {other}")),
        }
    };
    let mut cmd = Command::new(&bin);
    cmd.arg("--version");
    hide_console(&mut cmd);
    let output = cmd
        .output()
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!("{bin} not found")
            } else {
                format!("failed to run {bin}: {e}")
            }
        })?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!("{bin} exited with {}", output.status))
    }
}

fn emit_error(channel: &Channel<AgentStreamEvent>, kind: StreamErrorKind, message: String) {
    let _ = channel.send(AgentStreamEvent::Error { kind, message });
}

/// Spawn the CLI, feed it stdin, and pump its stdout lines through the adapter
/// parser onto the channel. `kill_on_drop` + start_kill on a dead receiver keep
/// no orphaned agent process behind a closed window.
async fn run(
    adapter: &(dyn Adapter + Send + Sync),
    configured_path: &str,
    req: &AgentRequest,
    channel: &Channel<AgentStreamEvent>,
) {
    let bin = if configured_path.is_empty() {
        adapter.default_bin().to_string()
    } else {
        configured_path.to_string()
    };
    let spawn = adapter.build(req);

    let mut cmd = Command::new(&bin);
    cmd.args(&spawn.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(if spawn.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .kill_on_drop(true);
    hide_console(&mut cmd);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                emit_error(
                    channel,
                    StreamErrorKind::Auth,
                    format!("{bin} not found — install it or set its path in Settings"),
                );
            } else {
                emit_error(
                    channel,
                    StreamErrorKind::Api,
                    format!("failed to launch {bin}: {e}"),
                );
            }
            return;
        }
    };

    if let Some(payload) = spawn.stdin {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(payload.as_bytes()).await;
            let _ = stdin.shutdown().await; // EOF so the CLI starts working
        }
    }

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => return,
    };
    let mut lines = BufReader::new(stdout).lines();
    let mut done = false;

    while let Ok(Some(line)) = lines.next_line().await {
        for event in adapter.parse_line(&line) {
            let terminal = matches!(
                &event,
                AgentStreamEvent::Done { .. } | AgentStreamEvent::Error { .. }
            );
            if channel.send(event).is_err() {
                let _ = child.start_kill(); // webview gone — don't leak the process
                return;
            }
            if terminal {
                done = true;
            }
        }
    }

    let _ = child.wait().await;
    if !done {
        let _ = channel.send(AgentStreamEvent::Done { is_error: None });
    }
}

// ---------------------------------------------------------------------------
// Shared helpers for adapters (message flattening + data-URL images)
// ---------------------------------------------------------------------------

/// Plain text of one message's content (string, or the text parts of an array).
fn message_text(content: &Value) -> String {
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    if let Some(parts) = content.as_array() {
        let mut out = String::new();
        for part in parts {
            if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                    out.push_str(t);
                }
            }
        }
        return out;
    }
    String::new()
}

/// The system messages joined — becomes the CLI's appended system prompt.
fn collect_system(messages: &[ChatMessage]) -> String {
    messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| message_text(&m.content))
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// The non-system turns flattened into a single labeled transcript. Stateless:
/// the whole conversation is resent each turn (as the OpenRouter path also does).
fn collect_body(messages: &[ChatMessage]) -> String {
    let mut lines = Vec::new();
    for m in messages.iter().filter(|m| m.role != "system") {
        let text = message_text(&m.content);
        if text.is_empty() {
            continue;
        }
        let label = match m.role.as_str() {
            "assistant" => "Assistant",
            "tool" => "Tool result",
            _ => "User",
        };
        lines.push(format!("{label}: {text}"));
    }
    lines.join("\n\n")
}

/// (media_type, base64 data) from a `data:<media>;base64,<data>` URL.
fn parse_data_url(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("data:")?;
    let (meta, data) = rest.split_once(',')?;
    let media = meta.strip_suffix(";base64")?;
    Some((media.to_string(), data.to_string()))
}

/// Anthropic image content blocks for every `image_url` data URL in the messages.
/// Observation no longer sends images (semantic snapshots are text-only); this
/// remains for generic chat messages that attach one.
fn collect_image_blocks(messages: &[ChatMessage]) -> Vec<Value> {
    let mut blocks = Vec::new();
    for m in messages {
        if let Some(parts) = m.content.as_array() {
            for part in parts {
                if part.get("type").and_then(|t| t.as_str()) != Some("image_url") {
                    continue;
                }
                let url = part.pointer("/image_url/url").and_then(|u| u.as_str());
                if let Some((media_type, data)) = url.and_then(parse_data_url) {
                    blocks.push(serde_json::json!({
                        "type": "image",
                        "source": { "type": "base64", "media_type": media_type, "data": data }
                    }));
                }
            }
        }
    }
    blocks
}
