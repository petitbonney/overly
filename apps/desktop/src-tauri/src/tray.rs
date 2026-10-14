//! The tray icon: a status line, Dashboard and Quit. The status also shows as the tooltip, except on
//! Linux, where AppIndicator has no tooltips (hence the status line).

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, include_image};

use crate::supervisor::SupervisorHandle;

const STATUS_ID: &str = "status";
const DASHBOARD_ID: &str = "dashboard";
const QUIT_ID: &str = "quit";

pub fn create(app: &AppHandle, supervisor: &SupervisorHandle) -> tauri::Result<()> {
    let mut status = supervisor.status();
    let current = status.borrow().clone();

    let status_item = MenuItem::with_id(app, STATUS_ID, current.label(), false, None::<&str>)?;
    let dashboard = MenuItem::with_id(app, DASHBOARD_ID, "Dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&status_item, &separator, &dashboard, &quit])?;

    let tray = TrayIconBuilder::with_id("overly")
        .icon(include_image!("icons/32x32.png"))
        .tooltip(current.tooltip())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            DASHBOARD_ID => crate::open_dashboard(app),
            QUIT_ID => crate::quit(app),
            _ => {}
        })
        .build(app)?;

    tauri::async_runtime::spawn(async move {
        loop {
            let current = status.borrow_and_update().clone();
            if let Err(error) = status_item.set_text(current.label()) {
                log::warn!("Can't update the tray status: {error}");
            }
            if let Err(error) = tray.set_tooltip(Some(current.tooltip())) {
                log::warn!("Can't update the tray tooltip: {error}");
            }
            if status.changed().await.is_err() {
                break;
            }
        }
    });
    Ok(())
}
