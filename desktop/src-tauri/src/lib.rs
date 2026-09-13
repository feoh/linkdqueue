#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod commands;
pub mod credentials;
pub mod domain;
pub mod error;
pub mod http;
pub mod menu;
pub mod opener;
pub mod preferences;
pub mod session;
pub mod validation;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;

            let native_menu = menu::build_menu(app)?;
            app.set_menu(native_menu)?;
            app.on_menu_event(menu::handle_menu_event);

            let config_dir = app
                .path()
                .app_config_dir()
                .map_err(|error| setup_error(error.to_string()))?;
            let service = commands::session_from_config_dir(config_dir)
                .map_err(|error| setup_error(error.message))?;
            app.manage(service.clone());
            tauri::async_runtime::spawn(async move {
                let _ = service.bootstrap().await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::test_connection,
            commands::save_connection,
            commands::clear_connection,
            commands::set_display_preferences,
            commands::list_bookmarks,
            commands::list_tags,
            commands::create_bookmark,
            commands::mark_read,
            commands::replace_bookmark_tags,
            commands::archive_bookmark,
            commands::unarchive_bookmark,
            commands::delete_bookmark,
            commands::open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Linkdqueue Desktop");
}

fn setup_error(message: String) -> Box<dyn std::error::Error> {
    Box::new(std::io::Error::other(message))
}
