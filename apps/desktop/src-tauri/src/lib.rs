//! The Overly desktop shell: a tray icon that runs the Node sidecar (ADR 0001).

pub mod backoff;
mod job;
pub mod locate;
pub mod protocol;
pub mod status;
pub mod supervisor;

/// The app context built from `tauri.conf.json`. The macro can only be expanded once per binary.
fn context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

pub fn run() {
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
