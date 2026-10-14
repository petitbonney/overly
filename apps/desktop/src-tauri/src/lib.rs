//! The Overly desktop shell: a tray icon that runs the Node sidecar (ADR 0001). It opens no
//! windows (ADR 0002): the dashboard opens in the default browser.

pub mod backoff;
mod job;
pub mod locate;
pub mod protocol;
pub mod status;
pub mod supervisor;
mod tray;

use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_opener::OpenerExt;

use crate::locate::Environment;
use crate::supervisor::{SupervisorConfig, SupervisorHandle};

/// The app context built from `tauri.conf.json`. The macro can only be expanded once per binary.
fn context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

/// Finds Node.js and the server bundle, then starts the supervisor in Tauri's async runtime.
fn start_supervisor(app: &AppHandle) -> SupervisorHandle {
    let exists = |path: &Path| path.is_file();
    let environment = Environment {
        node_override: std::env::var_os("OVERLY_NODE").map(PathBuf::from),
        script_override: std::env::var_os("OVERLY_SERVER_SCRIPT").map(PathBuf::from),
        exe_dir: std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf)),
        resource_dir: app.path().resource_dir().ok(),
        dev_fallbacks: cfg!(debug_assertions),
        exists: &exists,
    };
    match (
        locate::node_binary(&environment),
        locate::server_script(&environment),
    ) {
        (Ok(node), Ok(script)) => {
            log::info!(
                "Starting the Overly server: {} {}",
                node.display(),
                script.display()
            );
            let config = SupervisorConfig::new(node, script);
            // spawn() needs a tokio runtime context: run it inside Tauri's.
            tauri::async_runtime::block_on(async move { SupervisorHandle::spawn(config) })
        }
        (Err(error), _) | (_, Err(error)) => {
            log::error!("{error}");
            SupervisorHandle::failed(error.to_string())
        }
    }
}

/// The supervisor, once setup has stored it.
fn supervisor(app: &AppHandle) -> Option<SupervisorHandle> {
    app.try_state::<SupervisorHandle>()
        .map(|state| state.inner().clone())
}

/// Opens the dashboard in the default browser, once the server is running.
pub(crate) fn open_dashboard(app: &AppHandle) {
    let Some(supervisor) = supervisor(app) else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match supervisor.dashboard_url().await {
            Ok(url) => {
                if let Err(error) = app.opener().open_url(url, None::<&str>) {
                    log::error!("Can't open the browser: {error}");
                }
            }
            Err(error) => log::warn!("Can't open the dashboard: {error}"),
        }
    });
}

/// Stops the server (killing it if it doesn't stop in time), then exits.
pub(crate) fn quit(app: &AppHandle) {
    let supervisor = supervisor(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(supervisor) = supervisor {
            supervisor.shutdown().await;
        }
        app.exit(0);
    });
}

pub fn run() {
    let app = tauri::Builder::default()
        // First, so a second launch is caught before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            open_dashboard(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let supervisor = start_supervisor(app.handle());
            tray::create(app.handle(), &supervisor)?;
            app.manage(supervisor);
            Ok(())
        })
        .build(context())
        .expect("error while building Overly");

    app.run(|app, event| {
        if let (RunEvent::Exit, Some(supervisor)) = (event, supervisor(app)) {
            // Quit already stopped the server. Any other exit path stops it here.
            tauri::async_runtime::block_on(async move {
                let _ = tokio::time::timeout(Duration::from_secs(10), supervisor.shutdown()).await;
            });
        }
    });
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
