// S1.5 — Lightweight foreground-window context for the observation loop.
// Cheap enough to poll frequently; any failure degrades to None.
use serde::Serialize;

/// Mirrors contract.ts `ActiveWindow` (snake_case).
#[derive(Debug, Clone, Serialize)]
pub struct ActiveWindow {
    pub app_name: String,
    pub title: String,
}

#[tauri::command]
pub fn active_window() -> Option<ActiveWindow> {
    active_win_pos_rs::get_active_window()
        .ok()
        .map(|w| ActiveWindow {
            app_name: w.app_name,
            title: w.title,
        })
}
