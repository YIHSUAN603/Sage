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
    /// Model used for observation (text-only prompts). May equal chat_model.
    #[serde(default)]
    pub observe_model: String,
    /// Master switch for the observation subsystem (window sampling, semantic
    /// snapshots, chat context injection). Off by default (privacy).
    #[serde(default)]
    pub observe_enabled: bool,
    /// Master switch for proactive bubbles. Independent of observation:
    /// with observation on it chats about what it sees, off it just chats
    /// blind; observation on + this off = silent context-only sampling.
    #[serde(default = "default_true")]
    pub proactive_enabled: bool,
    /// Seconds between active-window polls when observing.
    #[serde(default = "default_interval")]
    pub observe_interval: u32,
    /// User-added sensitive-window entries (app names / title keywords),
    /// case-insensitive substrings. Extends privacy.rs's built-in blocklist.
    #[serde(default)]
    pub observe_blocklist: Vec<String>,
    /// Route observation requests only to OpenRouter providers that don't
    /// retain/train on inputs (provider.data_collection = "deny").
    #[serde(default = "default_true")]
    pub observe_deny_data_collection: bool,
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
    /// Custom persona for the built-in Sage companion. Empty = i18n default.
    #[serde(default)]
    pub custom_persona: String,
    /// Minimum minutes between proactive observation asks. A pet's
    /// `sage.proactive.cooldownMinutes` overrides this.
    #[serde(default = "default_proactive_cooldown")]
    pub proactive_cooldown_minutes: f64,
    /// Max proactive bubbles per rolling hour; 0 = unlimited. A pet's
    /// `sage.proactive.maxPerHour` overrides this.
    #[serde(default)]
    pub proactive_max_per_hour: u32,
    /// Master switch for long-term memory (index injection, save/recall/forget
    /// tools, conversation persistence). On by default.
    #[serde(default = "default_true")]
    pub memory_enabled: bool,
}

fn default_proactive_cooldown() -> f64 {
    2.0
}

fn default_interval() -> u32 {
    8
}

fn default_true() -> bool {
    true
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
            proactive_enabled: true,
            observe_interval: default_interval(),
            observe_blocklist: Vec::new(),
            observe_deny_data_collection: true,
            referer: "https://github.com/sage".into(),
            language: default_language(),
            active_pet: String::new(),
            custom_persona: String::new(),
            proactive_cooldown_minutes: default_proactive_cooldown(),
            proactive_max_per_hour: 0,
            memory_enabled: true,
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

/// Parse a settings file, migrating pre-`proactive_enabled` files: those had
/// `idle_chatter_enabled` (chatter while observation was off) and observation
/// that always chattered — so the equivalent master switch is
/// `observe_enabled || idle_chatter_enabled`. The legacy key is simply
/// ignored afterwards and disappears on the next save.
fn parse(json: &str) -> Option<Settings> {
    let mut value: serde_json::Value = serde_json::from_str(json).ok()?;
    let obj = value.as_object_mut()?;
    if !obj.contains_key("proactive_enabled") {
        let observe = obj
            .get("observe_enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let chatter = obj
            .get("idle_chatter_enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        obj.insert("proactive_enabled".into(), (observe || chatter).into());
    }
    serde_json::from_value(value).ok()
}

pub fn load(app: &tauri::AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| parse(&s))
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Settings {
    load(&app)
}

#[cfg(test)]
mod tests {
    use super::parse;

    fn flags(json: &str) -> (bool, bool) {
        let s = parse(json).expect("parse settings");
        (s.observe_enabled, s.proactive_enabled)
    }

    #[test]
    fn migrates_legacy_flag_combinations() {
        // Legacy observe=on always chattered ⇒ proactive stays on either way.
        assert_eq!(
            flags(r#"{"observe_enabled":true,"idle_chatter_enabled":true}"#),
            (true, true)
        );
        assert_eq!(
            flags(r#"{"observe_enabled":true,"idle_chatter_enabled":false}"#),
            (true, true)
        );
        assert_eq!(
            flags(r#"{"observe_enabled":false,"idle_chatter_enabled":true}"#),
            (false, true)
        );
        assert_eq!(
            flags(r#"{"observe_enabled":false,"idle_chatter_enabled":false}"#),
            (false, false)
        );
    }

    #[test]
    fn missing_legacy_keys_use_defaults() {
        // No flags at all: observe defaults off, chatter defaulted on.
        assert_eq!(flags("{}"), (false, true));
    }

    #[test]
    fn explicit_proactive_flag_wins_over_legacy() {
        assert_eq!(
            flags(r#"{"observe_enabled":true,"idle_chatter_enabled":true,"proactive_enabled":false}"#),
            (true, false)
        );
    }
}

#[tauri::command]
pub fn set_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let path = settings_path(&app)?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("write settings: {e}"))
}
