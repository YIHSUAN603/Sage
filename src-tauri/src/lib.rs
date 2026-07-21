mod capture;
mod context;
mod llm;
mod pets;
mod settings;
mod skills;
mod tools;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            llm::chat_stream,
            capture::capture_screen,
            context::active_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
