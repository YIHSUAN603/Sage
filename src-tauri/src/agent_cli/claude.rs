// Claude Code adapter: `claude -p` with stream-json in/out. Read-only posture is
// the allowlist (in print mode any non-allowlisted tool needing approval is
// auto-denied). The conversation goes in as one stream-json user message (text +
// inline image blocks); system messages become --append-system-prompt.
use serde_json::Value;

use super::{
    collect_body, collect_image_blocks, collect_system, AgentRequest, AgentStreamEvent, Adapter,
    Spawn,
};

/// Read-only tools the chat turn may use. Observe passes no tools at all.
const READ_ONLY_TOOLS: &[&str] = &["Read", "Grep", "Glob", "WebFetch", "WebSearch"];

pub struct Claude;

impl Adapter for Claude {
    fn default_bin(&self) -> &'static str {
        "claude"
    }

    fn build(&self, req: &AgentRequest) -> Spawn {
        let mut args: Vec<String> = vec![
            "-p".into(),
            "--output-format".into(),
            "stream-json".into(),
            "--input-format".into(),
            "stream-json".into(),
            "--verbose".into(),
            "--include-partial-messages".into(),
        ];

        if !req.model.is_empty() {
            args.push("--model".into());
            args.push(req.model.clone());
        }

        let system = collect_system(&req.messages);
        if !system.is_empty() {
            args.push("--append-system-prompt".into());
            args.push(system);
        }

        // Read-only allowlist is the sandbox. Keep --allowedTools last: it is
        // variadic and would otherwise swallow following flags.
        args.push("--allowedTools".into());
        if req.purpose == "observe" {
            args.push(String::new()); // no tools — just look and answer
        } else {
            args.extend(READ_ONLY_TOOLS.iter().map(|t| t.to_string()));
        }

        // One stream-json user message: flattened transcript + any inline images.
        let mut content: Vec<Value> = vec![serde_json::json!({
            "type": "text",
            "text": collect_body(&req.messages),
        })];
        content.extend(collect_image_blocks(&req.messages));
        let stdin = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": content },
        })
        .to_string();

        Spawn {
            args,
            stdin: Some(format!("{stdin}\n")),
        }
    }

    fn parse_line(&self, line: &str) -> Vec<AgentStreamEvent> {
        parse_line(line)
    }
}

/// Free function so tests can drive it without constructing the adapter.
pub fn parse_line(line: &str) -> Vec<AgentStreamEvent> {
    let line = line.trim();
    if line.is_empty() {
        return vec![];
    }
    let v: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return vec![], // tolerate keep-alive / non-JSON noise
    };

    match v.get("type").and_then(|t| t.as_str()) {
        // Token streaming: only text deltas; thinking/signature/tool-arg deltas ignored.
        Some("stream_event") => {
            let is_text_delta = v.pointer("/event/type").and_then(|t| t.as_str())
                == Some("content_block_delta")
                && v.pointer("/event/delta/type").and_then(|t| t.as_str()) == Some("text_delta");
            if is_text_delta {
                if let Some(text) = v.pointer("/event/delta/text").and_then(|t| t.as_str()) {
                    if !text.is_empty() {
                        return vec![AgentStreamEvent::Delta {
                            content: text.to_string(),
                        }];
                    }
                }
            }
            vec![]
        }
        // Aggregated assistant message: take only tool_use blocks (text already streamed).
        Some("assistant") => content_blocks(&v)
            .iter()
            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
            .map(|b| AgentStreamEvent::ToolUse {
                id: str_field(b, "id"),
                name: str_field(b, "name"),
                input: b.get("input").cloned().unwrap_or(Value::Null),
            })
            .collect(),
        // Tool results arrive as a user message.
        Some("user") => content_blocks(&v)
            .iter()
            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
            .map(|b| AgentStreamEvent::ToolResult {
                id: str_field(b, "tool_use_id"),
                content: stringify_tool_result(b.get("content")),
                is_error: b.get("is_error").and_then(|x| x.as_bool()),
            })
            .collect(),
        Some("result") => {
            let is_error = v.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false);
            if is_error {
                vec![AgentStreamEvent::Error {
                    kind: crate::llm::StreamErrorKind::Api,
                    message: v
                        .get("result")
                        .and_then(|x| x.as_str())
                        .unwrap_or("agent run failed")
                        .to_string(),
                }]
            } else {
                vec![AgentStreamEvent::Done {
                    is_error: Some(false),
                }]
            }
        }
        _ => vec![], // system / rate_limit_event / hook_* — ignore
    }
}

fn content_blocks(v: &Value) -> Vec<Value> {
    v.pointer("/message/content")
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default()
}

fn str_field(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

/// tool_result `content` is a string or an array of `{type:text,text}` blocks.
fn stringify_tool_result(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join(""),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_delta_becomes_delta() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}}"#;
        match parse_line(line).as_slice() {
            [AgentStreamEvent::Delta { content }] => assert_eq!(content, "hi"),
            other => panic!("expected one delta, got {other:?}"),
        }
    }

    #[test]
    fn thinking_delta_is_ignored() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"x"}}}"#;
        assert!(parse_line(line).is_empty());
    }

    #[test]
    fn assistant_tool_use_block() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"skip me"},{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/a"}}]}}"#;
        match parse_line(line).as_slice() {
            [AgentStreamEvent::ToolUse { id, name, input }] => {
                assert_eq!(id, "toolu_1");
                assert_eq!(name, "Read");
                assert_eq!(input.pointer("/file_path").unwrap(), "/a");
            }
            other => panic!("expected one tool_use, got {other:?}"),
        }
    }

    #[test]
    fn user_tool_result_stringifies_array_content() {
        let line = r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":[{"type":"text","text":"file body"}]}]}}"#;
        match parse_line(line).as_slice() {
            [AgentStreamEvent::ToolResult { id, content, .. }] => {
                assert_eq!(id, "toolu_1");
                assert_eq!(content, "file body");
            }
            other => panic!("expected one tool_result, got {other:?}"),
        }
    }

    #[test]
    fn result_success_is_done() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"result":"hi"}"#;
        assert!(matches!(
            parse_line(line).as_slice(),
            [AgentStreamEvent::Done { is_error: Some(false) }]
        ));
    }

    #[test]
    fn result_error_surfaces_as_error() {
        let line = r#"{"type":"result","is_error":true,"result":"boom"}"#;
        match parse_line(line).as_slice() {
            [AgentStreamEvent::Error { message, .. }] => assert_eq!(message, "boom"),
            other => panic!("expected error, got {other:?}"),
        }
    }

    #[test]
    fn build_passes_model_and_read_only_allowlist() {
        let req = AgentRequest {
            cli: "claude".into(),
            messages: vec![],
            purpose: "chat".into(),
            model: "opus".into(),
        };
        let spawn = Claude.build(&req);
        assert!(spawn
            .args
            .windows(2)
            .any(|w| w[0] == "--model" && w[1] == "opus"));
        assert!(spawn.args.iter().any(|a| a == "--allowedTools"));
        assert!(spawn.args.iter().any(|a| a == "Read"));
        assert!(!spawn.args.iter().any(|a| a == "Write" || a == "Bash"));
    }

    #[test]
    fn build_omits_model_when_empty() {
        let req = AgentRequest {
            cli: "claude".into(),
            messages: vec![],
            purpose: "chat".into(),
            model: String::new(),
        };
        assert!(!Claude.build(&req).args.iter().any(|a| a == "--model"));
    }

    #[test]
    fn system_and_noise_are_ignored() {
        assert!(parse_line(r#"{"type":"system","subtype":"init"}"#).is_empty());
        assert!(parse_line(r#"{"type":"rate_limit_event"}"#).is_empty());
        assert!(parse_line("not json").is_empty());
    }
}
