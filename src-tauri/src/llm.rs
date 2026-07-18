// S1.3 — OpenRouter chat completion streaming over a Tauri Channel.
// Shapes mirror src/ipc/contract.ts exactly (snake_case fields, StreamEvent
// tagged by `type`). The API key never leaves Rust: it is read from settings
// here and only ever sent to OpenRouter.
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::settings;

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

// ---------------------------------------------------------------------------
// Request shapes (contract.ts: ChatRequest / ChatMessage / ToolCall / ToolDef)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ToolDef>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    /// string | ContentPart[] | null — kept as raw JSON so text/image parts are
    /// forwarded to OpenRouter verbatim (no image content part is ever lost).
    #[serde(default)]
    pub content: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: ToolCallFunction,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolCallFunction {
    pub name: String,
    /// JSON-encoded arguments string.
    pub arguments: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolDef {
    #[serde(rename = "type")]
    pub kind: String,
    pub function: ToolDefFunction,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolDefFunction {
    pub name: String,
    pub description: String,
    /// JSON Schema for the arguments object.
    pub parameters: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Stream events (contract.ts: StreamEvent / ToolCallDelta / StreamErrorKind)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallDelta {
    pub index: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function: Option<ToolCallDeltaFunction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallDeltaFunction {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamErrorKind {
    Auth,
    RateLimit,
    Network,
    Api,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Delta {
        #[serde(skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_calls: Option<Vec<ToolCallDelta>>,
    },
    Done {
        finish_reason: Option<String>,
    },
    Error {
        kind: StreamErrorKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<u16>,
        message: String,
    },
}

fn emit(channel: &Channel<StreamEvent>, event: StreamEvent) {
    // The webview side may already be gone (window closed, abort); nothing
    // useful to do with a send failure mid-stream.
    let _ = channel.send(event);
}

fn emit_error(
    channel: &Channel<StreamEvent>,
    kind: StreamErrorKind,
    status: Option<u16>,
    message: impl Into<String>,
) {
    emit(
        channel,
        StreamEvent::Error {
            kind,
            status,
            message: message.into(),
        },
    );
}

/// Pull a human-readable message out of an OpenRouter error body, which is
/// usually `{"error": {"message": "...", ...}}`. Falls back to the raw body.
fn api_error_message(body: &str) -> String {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(msg) = json
            .pointer("/error/message")
            .and_then(|m| m.as_str())
            .filter(|m| !m.is_empty())
        {
            return msg.to_string();
        }
    }
    let trimmed = body.trim();
    if trimmed.is_empty() {
        "request failed".to_string()
    } else {
        trimmed.chars().take(500).collect()
    }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn chat_stream(
    app: tauri::AppHandle,
    channel: Channel<StreamEvent>,
    req: ChatRequest,
) -> Result<(), String> {
    let settings = settings::load(&app);
    if settings.api_key.is_empty() {
        emit_error(
            &channel,
            StreamErrorKind::Auth,
            None,
            "no API key configured — add your OpenRouter key in settings",
        );
        return Ok(());
    }

    let mut body = match serde_json::to_value(&req) {
        Ok(v) => v,
        Err(e) => {
            emit_error(
                &channel,
                StreamErrorKind::Api,
                None,
                format!("failed to serialize request: {e}"),
            );
            return Ok(());
        }
    };
    body["stream"] = serde_json::Value::Bool(true);

    let client = reqwest::Client::new();
    let mut request = client
        .post(OPENROUTER_URL)
        .bearer_auth(&settings.api_key)
        .header("X-Title", "Sage")
        .json(&body);
    if !settings.referer.is_empty() {
        request = request.header("HTTP-Referer", &settings.referer);
    }

    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            emit_error(
                &channel,
                StreamErrorKind::Network,
                None,
                format!("request failed: {e}"),
            );
            return Ok(());
        }
    };

    let status = response.status();
    if !status.is_success() {
        let code = status.as_u16();
        let kind = match code {
            401 | 403 => StreamErrorKind::Auth,
            429 => StreamErrorKind::RateLimit,
            _ => StreamErrorKind::Api,
        };
        let body_text = response.text().await.unwrap_or_default();
        emit_error(&channel, kind, Some(code), api_error_message(&body_text));
        return Ok(());
    }

    // Read the SSE body chunk by chunk, splitting on newlines. Buffer bytes
    // (not strings) so multi-byte UTF-8 sequences split across chunks survive.
    let mut stream = response.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut done_sent = false;

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                emit_error(
                    &channel,
                    StreamErrorKind::Network,
                    None,
                    format!("stream read failed: {e}"),
                );
                return Ok(());
            }
        };
        buf.extend_from_slice(&chunk);

        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim_end_matches(['\n', '\r']);
            if handle_sse_line(line, &channel, &mut done_sent) {
                return Ok(());
            }
        }
    }

    // Stream ended without an explicit finish — still close out the channel
    // contract so the frontend promise settles.
    if !done_sent {
        emit(&channel, StreamEvent::Done { finish_reason: None });
    }
    Ok(())
}

/// Process one SSE line. Returns true when the stream is finished ([DONE] or
/// a terminal event was emitted) and reading should stop.
fn handle_sse_line(line: &str, channel: &Channel<StreamEvent>, done_sent: &mut bool) -> bool {
    // SSE comments (": OPENROUTER PROCESSING") and blank separators.
    let Some(payload) = line.strip_prefix("data:") else {
        return false;
    };
    let payload = payload.trim();

    if payload == "[DONE]" {
        if !*done_sent {
            emit(channel, StreamEvent::Done { finish_reason: None });
            *done_sent = true;
        }
        return true;
    }

    let json: serde_json::Value = match serde_json::from_str(payload) {
        Ok(v) => v,
        Err(_) => return false, // tolerate malformed keep-alive noise
    };

    // Mid-stream error object from OpenRouter.
    if let Some(err) = json.get("error") {
        let message = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("upstream error")
            .to_string();
        let status = err
            .get("code")
            .and_then(|c| c.as_u64())
            .map(|c| c as u16);
        emit_error(channel, StreamErrorKind::Api, status, message);
        *done_sent = true;
        return true;
    }

    let Some(choice) = json.pointer("/choices/0") else {
        return false;
    };

    if let Some(delta) = choice.get("delta") {
        let content = delta
            .get("content")
            .and_then(|c| c.as_str())
            .map(str::to_string);
        let tool_calls = delta
            .get("tool_calls")
            .cloned()
            .and_then(|tc| serde_json::from_value::<Vec<ToolCallDelta>>(tc).ok())
            .filter(|tc| !tc.is_empty());
        if content.is_some() || tool_calls.is_some() {
            emit(
                channel,
                StreamEvent::Delta {
                    content,
                    tool_calls,
                },
            );
        }
    }

    if let Some(reason) = choice.get("finish_reason").and_then(|r| r.as_str()) {
        if *done_sent {
            return false;
        }
        emit(
            channel,
            StreamEvent::Done {
                finish_reason: Some(reason.to_string()),
            },
        );
        *done_sent = true;
        // Keep reading until [DONE]; nothing more will be emitted.
    }
    false
}
