//! Startup behaviour: launch at login (hidden) and the tray icon that keeps the
//! app reachable while it is running in the background.
//!
//! The default is "start at login, hidden": the process registers itself once
//! and later launches pass `--hidden`, so the vault sits locked in the tray
//! until the user opens the window. The setting can be changed from Settings →
//! Preferences, and closing the window hides it instead of quitting.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::state::AppState;

const CONFIGURED_KEY: &str = "autostart_configured";

/// Register the app to start at login on first run, then hide the window when
/// this launch came from that entry.
pub fn apply_autostart(app: &AppHandle, hidden: bool) {
    let manager = app.autolaunch();
    let configured = {
        let state = app.state::<AppState>();
        match state.core.lock() {
            Ok(core) => core
                .auth
                .db()
                .get_setting(CONFIGURED_KEY)
                .ok()
                .flatten()
                .is_some(),
            Err(_) => true,
        }
    };
    if !configured {
        // Default on, once. A failure here (unsupported platform, policy) must
        // not stop the app from starting.
        let _ = manager.enable();
        let state = app.state::<AppState>();
        if let Ok(core) = state.core.lock() {
            let _ = core.auth.db().set_setting(CONFIGURED_KEY, "1");
        }
    }
    if hidden {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
}

/// Tray icon with Open / Lock / Quit.
pub fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Acuye Pass", true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", "Lock vault", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &lock, &quit])?;

    let mut builder = TrayIconBuilder::with_id("acuye-tray")
        .menu(&menu)
        .tooltip("Acuye Pass")
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "lock" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut core) = state.core.lock() {
                        core.session = None;
                    }
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[tauri::command]
pub fn autostart_enabled(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    let outcome = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    outcome.map_err(|_| "the startup setting could not be changed".to_string())?;
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(core) = state.core.lock() {
            let _ = core.auth.db().set_setting(CONFIGURED_KEY, "1");
        }
    }
    Ok(enabled)
}
