#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod credentials;
pub mod domain;
pub mod error;
pub mod preferences;
pub mod validation;

pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Linkdqueue Desktop");
}
