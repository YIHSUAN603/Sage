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

/// Raw foreground window, unfiltered, plus its process id — for the
/// semantic-snapshot gate, so the window whose content gets read is exactly
/// the window whose title just passed the blocklist. The pid feeds the
/// platform accessibility backends (Track M/W).
pub struct FocusedWindow {
    pub app_name: String,
    pub title: String,
    /// Owner pid — the macOS AX backend builds AXUIElementCreateApplication
    /// from it, the Windows UIA backend cross-checks the window's owner.
    pub process_id: u32,
}

// macOS has its own backend (context_macos.rs) so the observation subsystem
// never needs the Screen Recording permission; everywhere else the crate's
// platform APIs carry no such cost.
#[cfg(target_os = "macos")]
pub use crate::context_macos::current_focused;

#[cfg(not(target_os = "macos"))]
pub fn current_focused() -> Option<FocusedWindow> {
    active_win_pos_rs::get_active_window()
        .ok()
        .map(|w| FocusedWindow {
            app_name: w.app_name,
            title: w.title,
            process_id: w.process_id as u32,
        })
}

/// Raw foreground window, unfiltered — for internal callers
/// that need the real title to match the blocklist.
pub fn current() -> Option<ActiveWindow> {
    current_focused().map(|w| ActiveWindow {
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
            crate::privacy::sanitize_text(&w.title)
        };
        ActiveWindow {
            app_name: w.app_name,
            title,
        }
    })
}
