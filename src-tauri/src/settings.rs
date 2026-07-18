// Local, on-disk user settings (API key, model choices, observe prefs).
// Stored as JSON in the app config dir; never committed, never sent to the webview
// except through the explicit `get_settings` command.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub api_key: String,
    /// Model used for chat + tool calling (must support `tools`).
    #[serde(default)]
    pub chat_model: String,
    /// Model used to observe the screen (must accept image input). May equal chat_model.
    #[serde(default)]
    pub observe_model: String,
    /// Master switch for the observation subsystem. Off by default (privacy).
    #[serde(default)]
    pub observe_enabled: bool,
    /// Seconds between active-window polls when observing.
    #[serde(default = "default_interval")]
    pub observe_interval: u32,
    /// Optional OpenRouter ranking header.
    #[serde(default)]
    pub referer: String,
}

fn default_interval() -> u32 {
    8
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            api_key: String::new(),
            chat_model: String::new(),
            observe_model: String::new(),
            observe_enabled: false,
            observe_interval: default_interval(),
            referer: "https://github.com/sage".into(),
        }
    }
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir config dir: {e}"))?;
    Ok(dir.join("settings.json"))
}

pub fn load(app: &tauri::AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Settings {
    load(&app)
}

#[tauri::command]
pub fn set_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let path = settings_path(&app)?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("write settings: {e}"))
}
