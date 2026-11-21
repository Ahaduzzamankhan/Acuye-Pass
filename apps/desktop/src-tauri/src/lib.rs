//! Acuye Pass desktop application.
//!
//! All vault, authentication, cryptography and updater logic lives in the
//! `acuye-*` crates. This crate is a thin, auditable bridge: it exposes narrowly
//! scoped Tauri commands, holds the unlocked session in memory and enforces the
//! idle timeout. The webview never touches the database directly.

mod advanced;
mod commands;
mod data;
mod error;
mod recovery;
mod startup;
mod state;
mod updates;
mod window;

use tauri::Manager;

use state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .setup(|app| {
            let state = AppState::init(app.handle())?;
            app.manage(state);
            startup::setup_tray(app)?;
            startup::apply_autostart(
                app.handle(),
                std::env::args().any(|argument| argument == "--hidden"),
            );
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Acuye Pass");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Closing the window hides it to the tray so the vault stays
                // available; quitting happens from the tray menu. Hiding never
                // bypasses the idle auto-lock.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            // authentication & session
            commands::app_status,
            commands::create_account,
            commands::add_account,
            commands::list_accounts,
            commands::unlock,
            commands::lock,
            commands::logout,
            commands::session_touch,
            commands::change_master_password,
            commands::rename_vault,
            commands::get_account,
            // startup
            startup::autostart_enabled,
            startup::set_autostart,
            // account recovery
            recovery::recovery_status,
            recovery::recovery_questions,
            recovery::enable_recovery,
            recovery::disable_recovery,
            recovery::recover_with_code,
            recovery::recover_with_answers,
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
            // authenticator, secrets, breach monitoring
            advanced::authenticator_entries,
            advanced::authenticator_add,
            advanced::authenticator_add_entry,
            advanced::authenticator_advance_counter,
            advanced::authenticator_export,
            advanced::secret_copy,
            advanced::secret_reveal,
            advanced::secret_access_log,
            advanced::secret_clear_history,
            advanced::secret_alerts,
            advanced::breach_check_item,
            advanced::breach_scan_vault,
            // hostless LAN pairing
            advanced::lan_identity,
            advanced::lan_pairing_offer,
            advanced::lan_await_pairing,
            advanced::lan_pair,
            advanced::lan_peers,
            advanced::lan_revoke_peer,
            advanced::lan_forget_peer,
            advanced::lan_test_peer,
            advanced::lan_answer_ping,
            advanced::lan_sync_peer,
            advanced::lan_accept_sync,
            // window chrome
            window::window_minimize,
            window::window_toggle_maximize,
            window::window_is_maximized,
            window::window_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Acuye Pass");
}
