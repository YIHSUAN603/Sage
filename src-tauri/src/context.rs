// S1.5 — Lightweight foreground-window context for the observation loop.
// Cheap enough to poll frequently; any failure degrades to None. Titles are
// privacy-filtered before leaving Rust: blocklisted windows get the
// SENSITIVE_TITLE sentinel, everything else is sanitized (emails, digit runs,
// tokens redacted) — every downstream consumer (gate prompt, store, broadcast)
// only ever sees the filtered form.
use serde::Serialize;

/// Mirrors contract.ts `ActiveWindow` (snake_case).
#[derive(Debug, Clone, Serialize)]
pub struct ActiveWindow {
    pub app_name: String,
    pub title: String,
}

/// Raw foreground window, unfiltered — for internal callers (capture gate)
/// that need the real title to match the blocklist.
pub fn current() -> Option<ActiveWindow> {
    active_win_pos_rs::get_active_window()
        .ok()
        .map(|w| ActiveWindow {
            app_name: w.app_name,
            title: w.title,
        })
}

#[tauri::command]
pub fn active_window(app: tauri::AppHandle) -> Option<ActiveWindow> {
    let settings = crate::settings::load(&app);
    current().map(|w| {
        let title = if crate::privacy::is_sensitive(&w.app_name, &w.title, &settings.observe_blocklist)
        {
            crate::privacy::SENSITIVE_TITLE.to_string()
        } else {
            crate::privacy::sanitize_title(&w.title)
        };
        ActiveWindow {
            app_name: w.app_name,
            title,
        }
    })
}
