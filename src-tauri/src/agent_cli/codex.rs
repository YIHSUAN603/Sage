// Codex adapter: `codex exec` with `--json` (JSONL events); the tool posture is
// the `--sandbox` level picked by `req.permission`. The whole conversation is fed on stdin
// (prompt sentinel `-`). Images are NOT sent: `codex exec -i` takes a file path
// (not inline data) and `--json` is known to hang with images. Observation is
// unaffected — its prompts are text-only (semantic snapshots) on every backend.
use serde_json::Value;

use super::{collect_body, collect_system, AgentRequest, AgentStreamEvent, Adapter, Spawn};

pub struct Codex;

impl Adapter for Codex {
    fn default_bin(&self) -> &'static str {
        "codex"
    }

    fn build(&self, req: &AgentRequest) -> Spawn {
        let sandbox = match req.permission.as_str() {
            "full" => "danger-full-access",
            "edit" => "workspace-write",
            _ => "read-only",
        };
        let mut args: Vec<String> = vec![
            "exec".into(),
            "--json".into(),
            "--sandbox".into(),
            sandbox.into(),
            "--skip-git-repo-check".into(),
        ];
        if !req.model.is_empty() {
            args.push("--model".into());
            args.push(req.model.clone());
        }
        args.push("-".into()); // read the prompt from stdin

        // codex exec takes a single instruction string: system prepended to the
        // flattened transcript.
        let system = collect_system(&req.messages);
        let body = collect_body(&req.messages);
        let prompt = if system.is_empty() {
            body
        } else {
            format!("{system}\n\n{body}")
        };

        Spawn {
            args,
            stdin: Some(prompt),
        }
    }

    fn parse_line(&self, line: &str) -> Vec<AgentStreamEvent> {
        parse_line(line)
    }
}

pub fn parse_line(line: &str) -> Vec<AgentStreamEvent> {
    let line = line.trim();
    if line.is_empty() {
        return vec![];
    }
    let v: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    match v.get("type").and_then(|t| t.as_str()) {
        // Items are reported as complete units; build cards from the completed one
        // (stateless — item.started is ignored so every tool gets a use+result pair).
        Some("item.completed") => {
            let item = match v.get("item") {
                Some(i) => i,
                None => return vec![],
            };
            match item.get("type").and_then(|t| t.as_str()) {
                Some("agent_message") => {
                    let text = item.get("text").and_then(|t| t.as_str()).unwrap_or("");
                    if text.is_empty() {
                        vec![]
                    } else {
                        vec![AgentStreamEvent::Delta {
                            content: format!("{text}\n"),
                        }]
                    }
                }
                Some("reasoning") | Some("todo_list") => vec![],
                // Any other item (command_execution, file_change, mcp_tool_call, …)
                // renders as a tool card.
                _ => {
                    let id = item
                        .get("id")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string();
                    let name = item
                        .get("type")
                        .and_then(|x| x.as_str())
                        .unwrap_or("tool")
                        .to_string();
                    let content = item
                        .get("aggregated_output")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| item.to_string());
                    let is_error = item
                        .get("exit_code")
                        .and_then(|c| c.as_i64())
                        .map(|c| c != 0)
                        .or_else(|| {
                            item.get("status")
                                .and_then(|s| s.as_str())
                                .map(|s| s == "failed")
                        });
                    vec![
                        AgentStreamEvent::ToolUse {
                            id: id.clone(),
                            name,
                            input: item.clone(),
                        },
                        AgentStreamEvent::ToolResult {
                            id,
                            content,
                            is_error,
                        },
                    ]
                }
            }
        }
        Some("turn.completed") => vec![AgentStreamEvent::Done {
            is_error: Some(false),
        }],
        Some("turn.failed") | Some("error") => vec![AgentStreamEvent::Error {
            kind: crate::llm::StreamErrorKind::Api,
            message: v
                .pointer("/error/message")
                .or_else(|| v.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("codex run failed")
                .to_string(),
        }],
        _ => vec![], // thread.started / turn.started / item.started — ignore
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_message_becomes_delta() {
        let line = r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hello"}}"#;
        match parse_line(line).as_slice() {
            [AgentStreamEvent::Delta { content }] => assert_eq!(content, "hello\n"),
            other => panic!("expected delta, got {other:?}"),
        }
    }

    #[test]
    fn command_execution_becomes_tool_use_and_result() {
        let line = r#"{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"cat poc.txt","aggregated_output":"body\n","exit_code":0,"status":"completed"}}"#;
        match parse_line(line).as_slice() {
            [AgentStreamEvent::ToolUse { id, name, .. }, AgentStreamEvent::ToolResult { content, is_error, .. }] =>
            {
                assert_eq!(id, "item_1");
                assert_eq!(name, "command_execution");
                assert_eq!(content, "body\n");
                assert_eq!(*is_error, Some(false));
            }
            other => panic!("expected tool_use + tool_result, got {other:?}"),
        }
    }

    #[test]
    fn nonzero_exit_marks_error() {
        let line = r#"{"type":"item.completed","item":{"id":"i","type":"command_execution","aggregated_output":"nope","exit_code":1,"status":"completed"}}"#;
        match parse_line(line).as_slice() {
            [_, AgentStreamEvent::ToolResult { is_error, .. }] => assert_eq!(*is_error, Some(true)),
            other => panic!("expected tool result, got {other:?}"),
        }
    }

    #[test]
    fn item_started_and_reasoning_are_ignored() {
        assert!(parse_line(
            r#"{"type":"item.started","item":{"id":"i","type":"command_execution"}}"#
        )
        .is_empty());
        assert!(parse_line(r#"{"type":"item.completed","item":{"type":"reasoning"}}"#).is_empty());
        assert!(parse_line(r#"{"type":"thread.started","thread_id":"x"}"#).is_empty());
    }

    fn req(purpose: &str, model: &str, permission: &str) -> AgentRequest {
        AgentRequest {
            cli: "codex".into(),
            messages: vec![],
            purpose: purpose.into(),
            model: model.into(),
            permission: permission.into(),
        }
    }

    #[test]
    fn build_passes_model_and_reads_prompt_from_stdin() {
        let spawn = Codex.build(&req("chat", "gpt-5-codex", "read_only"));
        assert!(spawn
            .args
            .windows(2)
            .any(|w| w[0] == "--model" && w[1] == "gpt-5-codex"));
        assert!(spawn.args.iter().any(|a| a == "read-only"));
        assert_eq!(spawn.args.last().unwrap(), "-"); // prompt via stdin
        assert!(spawn.stdin.is_some());
    }

    #[test]
    fn build_maps_permission_tiers_to_sandbox_levels() {
        for (permission, sandbox) in [
            ("read_only", "read-only"),
            ("edit", "workspace-write"),
            ("full", "danger-full-access"),
        ] {
            let spawn = Codex.build(&req("chat", "", permission));
            assert!(
                spawn
                    .args
                    .windows(2)
                    .any(|w| w[0] == "--sandbox" && w[1] == sandbox),
                "{permission} should map to {sandbox}"
            );
        }
    }

    #[test]
    fn turn_completed_is_done() {
        assert!(matches!(
            parse_line(r#"{"type":"turn.completed","usage":{}}"#).as_slice(),
            [AgentStreamEvent::Done { is_error: Some(false) }]
        ));
    }
}
