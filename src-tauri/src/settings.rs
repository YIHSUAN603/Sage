// Local, on-disk user settings (API key, model choices, observe prefs).
// Stored as JSON in the app config dir; never committed, never sent to the webview
// except through the explicit `get_settings` command.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// Which LLM backend drives chat + observation: "openrouter" or "agent_cli".
    #[serde(default = "default_backend")]
    pub backend: String,
    /// Which agent CLI to use when backend == "agent_cli": "claude" or "codex".
    #[serde(default = "default_agent_cli")]
    pub agent_cli: String,
    /// Optional absolute path to the agent CLI binary; empty ⇒ resolve on PATH.
    #[serde(default)]
    pub agent_cli_path: String,
    /// Model to pass the agent CLI; empty ⇒ the CLI's own default.
    #[serde(default)]
    pub agent_cli_model: String,
    /// Tool permission tier for agent-CLI chat: "read_only" | "edit" | "full".
    /// Observation is always read-only regardless of this value.
    #[serde(default = "default_agent_permission")]
    pub agent_cli_permission: String,
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
    /// UI + assistant language: "auto" (follow system) or a BCP-47 tag
    /// the frontend supports (zh-TW / en / zh-CN / ja).
    #[serde(default = "default_language")]
    pub language: String,
    /// Selected companion id (folder under <config>/pets/). Empty = built-in Sage.
    #[serde(default)]
    pub active_pet: String,
}

fn default_interval() -> u32 {
    8
}

fn default_backend() -> String {
    "openrouter".into()
}

fn default_agent_cli() -> String {
    "claude".into()
}

fn default_agent_permission() -> String {
    "read_only".into()
}

fn default_language() -> String {
    "auto".into()
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            backend: default_backend(),
            agent_cli: default_agent_cli(),
            agent_cli_path: String::new(),
            agent_cli_model: String::new(),
            agent_cli_permission: default_agent_permission(),
            api_key: String::new(),
            chat_model: String::new(),
            observe_model: String::new(),
            observe_enabled: false,
            observe_interval: default_interval(),
            referer: "https://github.com/sage".into(),
            language: default_language(),
            active_pet: String::new(),
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
