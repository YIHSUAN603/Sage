mod capture;
mod context;
mod llm;
mod settings;
mod skills;
mod tools;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::set_settings,
            tools::tool_read_file,
            skills::list_skills,
            skills::read_skill,
            llm::chat_stream,
            capture::capture_screen,
            context::active_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
