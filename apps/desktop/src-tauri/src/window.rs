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

/// Start a native resize drag from the JS edge handles on platforms where
/// undecorated windows do not get native hit-testing.
#[tauri::command]
pub fn window_start_resize(window: WebviewWindow, direction: String) -> Result<(), String> {
    use tauri::window::ResizeDirection;
    let direction = match direction.as_str() {
        "n" => ResizeDirection::North,
        "s" => ResizeDirection::South,
        "e" => ResizeDirection::East,
        "w" => ResizeDirection::West,
        "ne" => ResizeDirection::NorthEast,
        "nw" => ResizeDirection::NorthWest,
        "se" => ResizeDirection::SouthEast,
        "sw" => ResizeDirection::SouthWest,
        _ => return Err("invalid resize direction".into()),
    };
    window.start_resize_dragging(direction).map_err(|_| error())
}
