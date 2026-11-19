use tauri::WebviewWindow;

fn error() -> String {
    "window operation failed".into()
}

#[tauri::command]
pub fn window_minimize(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|_| error())
}

#[tauri::command]
pub fn window_toggle_maximize(window: WebviewWindow) -> Result<bool, String> {
    let maximized = window.is_maximized().map_err(|_| error())?;
    if maximized {
        window.unmaximize().map_err(|_| error())?;
    } else {
        window.maximize().map_err(|_| error())?;
    }
    window.is_maximized().map_err(|_| error())
}

#[tauri::command]
pub fn window_is_maximized(window: WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|_| error())
}

#[tauri::command]
pub fn window_close(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|_| error())
}
