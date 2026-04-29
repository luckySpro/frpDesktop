//! frpDesktop backend library entry.

mod paths;
mod error;
mod config;
mod frpc;
mod runner;
mod commands;

use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};
use tokio::sync::Mutex;

use crate::runner::process::RunnerState;

/// Shared application state.
pub struct AppState {
    pub runner: Arc<Mutex<RunnerState>>,
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    // Make sure the app also becomes frontmost on macOS.
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    }
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            // Intercept close: hide window instead of exiting.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let state = AppState {
                runner: Arc::new(Mutex::new(RunnerState::Stopped)),
            };
            app.manage(state);

            // Ensure application data directories exist on first launch.
            if let Err(e) = crate::paths::ensure_app_dirs(&app.handle()) {
                tracing::error!("ensure_app_dirs failed: {e:#}");
            }

            // Build tray menu.
            let show_item =
                MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
            let start_item =
                MenuItemBuilder::with_id("start", "启动 frpc").build(app)?;
            let stop_item =
                MenuItemBuilder::with_id("stop", "停止 frpc").build(app)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit_item =
                MenuItemBuilder::with_id("quit", "退出 frpDesktop").build(app)?;

            let menu = MenuBuilder::new(app)
                .items(&[
                    &show_item, &sep1, &start_item, &stop_item, &sep2, &quit_item,
                ])
                .build()?;

            let mut tray_builder = TrayIconBuilder::with_id("main")
                .tooltip("frpDesktop · frpc 管家")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => show_main_window(app),
                        "quit" => app.exit(0),
                        "start" => {
                            let app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = run_frpc_start(&app).await {
                                    tracing::warn!("tray start failed: {e:#}");
                                }
                            });
                        }
                        "stop" => {
                            let app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = run_frpc_stop(&app).await {
                                    tracing::warn!("tray stop failed: {e:#}");
                                }
                            });
                        }
                        _ => {}
                    }
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
                tray_builder = tray_builder.icon(icon);
            }
            tray_builder.build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // paths
            crate::commands::paths_info,
            crate::commands::reveal_in_finder,
            // migration
            crate::commands::migrate_from_path,
            // config
            crate::commands::config_load,
            crate::commands::config_save,
            crate::commands::config_parse_to_form,
            crate::commands::config_form_to_doc,
            crate::commands::config_validate,
            crate::commands::cert_pick_and_import,
            // frpc
            crate::commands::frpc_list_versions,
            crate::commands::frpc_install,
            crate::commands::frpc_current_version,
            // runner
            crate::commands::runner_start,
            crate::commands::runner_stop,
            crate::commands::runner_status,
            crate::commands::runner_tail_log,
            // launchd
            crate::commands::launchd_status,
            crate::commands::launchd_enable,
            crate::commands::launchd_disable,
        ])
        .build(tauri::generate_context!())
        .expect("error while running frpDesktop")
        .run(|app_handle, event| {
            // macOS: 主窗口被关闭到 Dock 后，点击 Dock 图标恢复窗口。
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    show_main_window(app_handle);
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = app_handle;
                let _ = event;
            }
        });
}

async fn run_frpc_start(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let state: tauri::State<AppState> = app.state();
    let paths = crate::paths::resolve(app)?;
    let frpc_bin = paths.current_link.clone();
    let profile = paths.default_profile.clone();
    let cwd = paths.data_dir.clone();
    let log_file = paths.log_file.clone();
    crate::runner::process::start(app, state.runner.clone(), &frpc_bin, &profile, &cwd, &log_file)
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(())
}

async fn run_frpc_stop(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let state: tauri::State<AppState> = app.state();
    crate::runner::process::stop(app, state.runner.clone())
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(())
}
