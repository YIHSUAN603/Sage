// Semantic snapshot of the focused window — the screenshot's replacement.
// Reads structured text through the platform accessibility API (macOS AX /
// Windows UIA) instead of pixels, so every field passes the privacy pipeline
// (blocklist gate + sanitize) and hard size caps before leaving Rust. Refuses
// outright when observation is disabled or the foreground window is
// blocklisted as sensitive, mirroring the old capture gate.
use serde::Serialize;

// Platform backends produce a RawSnapshot; everything else is shared. Tracks
// M/W implement read_focused() in their respective files.
#[cfg(target_os = "macos")]
#[path = "semantic_macos.rs"]
mod platform;
#[cfg(target_os = "windows")]
#[path = "semantic_windows.rs"]
mod platform;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub fn read_focused(
        _window: &crate::context::FocusedWindow,
    ) -> Result<super::RawSnapshot, String> {
        Err("unsupported platform".into())
    }
}

/// Mirrors contract.ts `SemanticSnapshot` (snake_case).
#[derive(Debug, Clone, Serialize)]
pub struct SemanticSnapshot {
    pub app_name: String,
    pub title: String,
    pub focused_role: String,
    pub focused_value: String,
    pub selection: String,
    pub texts: Vec<String>,
    pub truncated: bool,
}

/// What a platform backend reads, unfiltered — the shared layer sanitizes and
/// caps it. `texts` should arrive top-down in visual/tree order.
pub struct RawSnapshot {
    pub focused_role: String,
    pub focused_value: String,
    pub selection: String,
    pub texts: Vec<String>,
}

/// Per-fragment cap (chars): a title-sized line is plenty for one element.
const MAX_FRAGMENT_CHARS: usize = 200;
/// Cap on the summed length of all text fields (keeps prompts small).
const MAX_TOTAL_CHARS: usize = 2000;
/// Cap on how many window-text fragments survive.
const MAX_FRAGMENTS: usize = 20;

#[tauri::command]
pub fn semantic_snapshot(app: tauri::AppHandle) -> Result<SemanticSnapshot, String> {
    let settings = crate::settings::load(&app);
    if !settings.observe_enabled {
        // Message must match src/ipc/mock.ts.
        return Err("observation disabled".into());
    }

    // Privacy gate: never read the content of a sensitive foreground window.
    // The frontend falls back to title-only observation on any error here.
    let focused = crate::context::current_focused().ok_or("no focused window")?;
    if crate::privacy::is_sensitive(&focused.app_name, &focused.title, &settings.observe_blocklist)
    {
        // Message must match src/ipc/mock.ts.
        return Err("sensitive window".into());
    }

    let raw = platform::read_focused(&focused)?;
    Ok(assemble(
        focused.app_name,
        crate::privacy::sanitize_text(&focused.title),
        raw,
    ))
}

/// Sanitize one fragment, then trim it to the per-fragment cap and whatever
/// remains of the total budget, flagging any loss.
fn cap(text: &str, budget: &mut usize, truncated: &mut bool) -> String {
    let clean = crate::privacy::sanitize_text(text);
    let len = clean.chars().count();
    let take = len.min(MAX_FRAGMENT_CHARS).min(*budget);
    if take < len {
        *truncated = true;
    }
    *budget -= take;
    clean.chars().take(take).collect()
}

/// Sanitize every raw field and enforce the size caps. Pure — unit-testable
/// without a platform backend.
fn assemble(app_name: String, title: String, raw: RawSnapshot) -> SemanticSnapshot {
    let mut truncated = false;
    let mut budget = MAX_TOTAL_CHARS;

    let focused_value = cap(&raw.focused_value, &mut budget, &mut truncated);
    let selection = cap(&raw.selection, &mut budget, &mut truncated);
    let mut texts: Vec<String> = Vec::new();
    for text in &raw.texts {
        if texts.len() >= MAX_FRAGMENTS || budget == 0 {
            truncated = true;
            break;
        }
        let t = cap(text, &mut budget, &mut truncated);
        if !t.is_empty() {
            texts.push(t);
        }
    }

    SemanticSnapshot {
        app_name,
        title,
        // Roles are API identifiers (e.g. "AXTextArea"), never user content.
        focused_role: raw.focused_role,
        focused_value,
        selection,
        texts,
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(focused_value: &str, texts: &[&str]) -> RawSnapshot {
        RawSnapshot {
            focused_role: "AXTextArea".into(),
            focused_value: focused_value.into(),
            selection: String::new(),
            texts: texts.iter().map(|t| t.to_string()).collect(),
        }
    }

    #[test]
    fn assemble_sanitizes_every_field() {
        let snap = assemble(
            "Mail".into(),
            "Inbox".into(),
            RawSnapshot {
                focused_role: "AXTextField".into(),
                focused_value: "to: alice.wu@example.com".into(),
                selection: "card 4111 1111 1111 1111".into(),
                texts: vec!["env: sk-or-v1-abcdef1234567890".into()],
            },
        );
        assert_eq!(snap.focused_value, "to: ***");
        assert_eq!(snap.selection, "card ***");
        assert_eq!(snap.texts, vec!["env: ***"]);
        assert!(!snap.truncated);
    }

    #[test]
    fn assemble_caps_fragment_length() {
        let long = "字".repeat(500);
        let snap = assemble("App".into(), "T".into(), raw(&long, &[]));
        assert_eq!(snap.focused_value.chars().count(), 200);
        assert!(snap.truncated);
    }

    #[test]
    fn assemble_caps_fragment_count_and_total_budget() {
        let many: Vec<String> = (0..30).map(|i| format!("line {i} {}", "x".repeat(150))).collect();
        let refs: Vec<&str> = many.iter().map(|s| s.as_str()).collect();
        let snap = assemble("App".into(), "T".into(), raw("", &refs));
        assert!(snap.texts.len() <= 20);
        let total: usize = snap.texts.iter().map(|t| t.chars().count()).sum();
        assert!(total <= 2000);
        assert!(snap.truncated);
    }

    #[test]
    fn assemble_drops_empty_fragments() {
        let snap = assemble("App".into(), "T".into(), raw("", &["", "hello", ""]));
        assert_eq!(snap.texts, vec!["hello"]);
    }
}
