// User-activity signal for the observation loop: seconds since the last
// keyboard/mouse input, via the cross-platform `user-idle` crate (IOKit /
// GetLastInputInfo / X11-DBus under the hood). Needs no permission on any
// platform. Never fails upward — unknown just reads as an active user (0),
// so the caller can lean on it without error handling.
use serde::Serialize;

/// Mirrors contract.ts `ActivityState` (snake_case).
#[derive(Debug, Clone, Serialize)]
pub struct ActivityState {
    pub idle_seconds: u64,
}

#[tauri::command]
pub fn activity_state() -> ActivityState {
    let idle_seconds = user_idle::UserIdle::get_time()
        .map(|t| t.as_seconds())
        .unwrap_or(0);
    ActivityState { idle_seconds }
}
