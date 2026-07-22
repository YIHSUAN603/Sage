mod activity;
mod agent_cli;
mod context;
#[cfg(target_os = "macos")]
mod context_macos;
mod llm;
mod semantic;
mod pets;
mod privacy;
mod settings;
mod shell_path;
mod skills;
mod tools;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

/// Tray menu labels (show chat, quit) for the saved language. The webview i18n
/// can't reach the native tray, so we pick once at startup; "auto"/unknown →
/// English. Chosen at launch only — changing the language in-app needs a
/// restart to relabel the menu.
fn tray_labels(language: &str) -> (&'static str, &'static str) {
    match language {
        "zh-TW" => ("顯示對話", "離開"),
        "zh-CN" => ("显示对话", "退出"),
        "ja" => ("チャットを表示", "終了"),
        _ => ("Show chat", "Quit"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must run before anything spawns a child process: Finder-launched apps
    // get a minimal PATH, which hides the agent CLIs (claude/codex).
    shell_path::fix();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // A persistent tray icon is the only place to quit: every window is
            // frameless and skips the taskbar, so without this there's no way to
            // close the app on Windows.
            let (show_label, quit_label) = tray_labels(&settings::load(app.handle()).language);
            let show_i = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let mut builder = TrayIconBuilder::new()
                .tooltip("Sage")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(w) = app.get_webview_window("chat") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            builder.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::set_settings,
            tools::tool_read_file,
            skills::list_skills,
            skills::read_skill,
            pets::list_pets,
            pets::read_pet,
            pets::read_pet_atlas,
            pets::import_pet,
            pets::update_pet_sage,
            llm::chat_stream,
            agent_cli::agent_stream,
            agent_cli::check_agent_cli,
            semantic::semantic_snapshot,
            activity::activity_state,
            context::active_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
