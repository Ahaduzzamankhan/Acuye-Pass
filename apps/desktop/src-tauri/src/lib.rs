//! Acuye Pass desktop application.
//!
//! All vault, authentication, cryptography and updater logic lives in the
//! `acuye-*` crates. This crate is a thin, auditable bridge: it exposes narrowly
//! scoped Tauri commands, holds the unlocked session in memory and enforces the
//! idle timeout. The webview never touches the database directly.

mod commands;
mod data;
mod error;
mod state;
mod updates;
mod window;

use tauri::Manager;

use state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let state = AppState::init(app.handle())?;
            app.manage(state);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Acuye Pass");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Drop key material as early as possible on shutdown.
                if let Some(state) = window.try_state::<AppState>() {
                    if let Ok(mut core) = state.core.lock() {
                        core.session = None;
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // authentication & session
            commands::app_status,
            commands::create_account,
            commands::unlock,
            commands::lock,
            commands::logout,
            commands::session_touch,
            commands::change_master_password,
            commands::rename_vault,
            commands::get_account,
            // vault
            commands::list_items,
            commands::get_item,
            commands::create_item,
            commands::update_item,
            commands::delete_item,
            commands::duplicate_item,
            commands::toggle_favorite,
            commands::vault_counts,
            commands::security_report,
            commands::copy_field,
            commands::open_website,
            // generator
            commands::generate_password,
            commands::generate_passphrase,
            commands::evaluate_password,
            // settings & devices
            commands::get_settings,
            commands::save_settings,
            commands::set_update_channel,
            commands::list_devices,
            commands::revoke_device,
            commands::current_device_name,
            // data, import/export, backups, favicons
            data::storage_info,
            data::create_backup,
            data::list_backups,
            data::restore_backup,
            data::open_data_folder,
            data::open_backups_folder,
            data::open_exports_folder,
            data::import_preview,
            data::import_apply,
            data::export_encrypted,
            data::export_plaintext_csv,
            data::import_encrypted,
            data::inspect_encrypted_export,
            data::get_favicon,
            // updater
            updates::update_status,
            updates::check_for_updates,
            updates::download_update,
            updates::verify_update,
            updates::install_update,
            updates::discard_update,
            // window chrome
            window::window_minimize,
            window::window_toggle_maximize,
            window::window_is_maximized,
            window::window_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Acuye Pass");
}
