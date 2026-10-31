//! frpDesktop backend library entry.

mod certs;
mod commands;
mod config;
mod error;
mod frpc;
mod fsutil;
mod paths;
mod runner;
mod settings;

use std::sync::Arc;

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};
use tokio::sync::Mutex;

use crate::runner::process::{Runner, SharedRunner};

/// Shared application state.
pub struct AppState {
    pub runner: SharedRunner,
}

/// Command line flag passed by the login item so the app starts in the tray.
const MINIMIZED_FLAG: &str = "--minimized";

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn spawn_start(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state: tauri::State<AppState> = app.state();
        if let Err(e) = commands::start_frpc(&app, &state).await {
            tracing::warn!("start frpc failed: {e}");
            let _ = tauri::Emitter::emit(
                &app,
                "frpc://log",
                serde_json::json!({ "stream": "system", "line": format!("[frpDesktop] {e}") }),
            );
        }
    });
}

fn spawn_stop(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state: tauri::State<AppState> = app.state();
        let _ = runner::process::stop(&app, state.runner.clone()).await;
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![MINIMIZED_FLAG]),
        ))
        .on_window_event(|window, event| {
            // Closing the main window hides it to the tray; frpc keeps running.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            app.manage(AppState {
                runner: Arc::new(Mutex::new(Runner::default())),
            });

            let paths = match paths::ensure_app_dirs(app.handle()) {
                Ok(p) => Some(p),
                Err(e) => {
                    tracing::error!("ensure_app_dirs failed: {e:#}");
                    None
                }
            };

            if std::env::args().any(|a| a == MINIMIZED_FLAG) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            let show_item = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
            let start_item = MenuItemBuilder::with_id("start", "启动 frpc").build(app)?;
            let stop_item = MenuItemBuilder::with_id("stop", "停止 frpc").build(app)?;
            let restart_item = MenuItemBuilder::with_id("restart", "重启 frpc").build(app)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出 frpDesktop").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[
                    &show_item,
                    &sep1,
                    &start_item,
                    &stop_item,
                    &restart_item,
                    &sep2,
                    &quit_item,
                ])
                .build()?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("frpDesktop · frpc 管家")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    "start" => spawn_start(app),
                    "stop" => spawn_stop(app),
                    "restart" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state: tauri::State<AppState> = app.state();
                            let _ = runner::process::stop(&app, state.runner.clone()).await;
                            spawn_start(&app);
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;

            if let Some(p) = paths {
                let s = p.settings();
                if s.start_frpc_on_launch && p.default_profile.exists() {
                    spawn_start(app.handle());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::reveal_path,
            commands::open_url,
            commands::settings_get,
            commands::settings_save,
            commands::autostart_get,
            commands::autostart_set,
            commands::config_load,
            commands::config_parse,
            commands::config_render,
            commands::config_check,
            commands::config_save,
            commands::config_verify,
            commands::config_import,
            commands::certs_list,
            commands::certs_import,
            commands::certs_delete,
            commands::frpc_list_versions,
            commands::frpc_installed,
            commands::frpc_install,
            commands::frpc_use,
            commands::frpc_uninstall,
            commands::runner_start,
            commands::runner_stop,
            commands::runner_restart,
            commands::runner_status,
            commands::runner_tail_log,
            commands::runner_clear_log,
            commands::daemon_status,
            commands::daemon_enable,
            commands::daemon_disable,
            commands::daemon_restart,
        ])
        .build(tauri::generate_context!())
        .expect("error while running frpDesktop")
        .run(|app_handle, event| match event {
            // Never leave an orphaned frpc behind when the app quits.
            tauri::RunEvent::Exit => {
                let state: tauri::State<AppState> = app_handle.state();
                let runner = state.runner.clone();
                let app = app_handle.clone();
                tauri::async_runtime::block_on(async move {
                    let _ = runner::process::stop(&app, runner).await;
                });
            }
            // macOS: clicking the Dock icon brings the hidden window back.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => show_main_window(app_handle),
            _ => {}
        });
}
