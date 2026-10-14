// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// The app context built from `tauri.conf.json`. The macro can only be expanded once per binary.
fn context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

fn main() {
    // Phase 0: an empty shell. The tray and the Node sidecar arrive in Phase 1.
    tauri::Builder::default()
        .run(context())
        .expect("error while running Overly");
}

#[cfg(test)]
mod tests {
    #[test]
    fn product_name_is_overly() {
        assert_eq!(
            super::context().config().product_name.as_deref(),
            Some("Overly")
        );
    }
}
