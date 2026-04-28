//! Tauri command bindings — thin glue over modules.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::config;
use crate::error::{AppError, AppResult};
use crate::frpc;
use crate::paths::{self, AppPaths};
use crate::runner;
use crate::runner::launchd::LaunchdStatus;
use crate::runner::process::RunnerStatus;
use crate::AppState;

// ------------------- paths / migration -------------------

#[derive(Debug, Clone, Serialize)]
pub struct PathsInfo {
    pub paths: AppPaths,
    pub profile_exists: bool,
    pub frpc_installed: bool,
}

#[tauri::command]
pub async fn paths_info(app: AppHandle) -> AppResult<PathsInfo> {
    let p = paths::ensure_app_dirs(&app)?;
    let profile_exists = p.default_profile.exists();
    let frpc_installed = p.current_link.exists();
    Ok(PathsInfo {
        paths: p,
        profile_exists,
        frpc_installed,
    })
}

#[tauri::command]
pub async fn reveal_in_finder(path: String) -> AppResult<()> {
    let output = std::process::Command::new("open").arg(&path).output()?;
    if !output.status.success() {
        return Err(AppError::msg(format!(
            "open failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    Ok(())
}

/// Import from an existing working directory:
/// - copies `frpc.toml` → profiles/default.toml
/// - copies any `*.crt` / `*.key` referenced by proxies into certs/ and
///   rewrites crtPath/keyPath to `./certs/<name>` relative to data_dir.
#[tauri::command]
pub async fn migrate_from_path(app: AppHandle, source_dir: String) -> AppResult<String> {
    let p = paths::ensure_app_dirs(&app)?;
    let src = PathBuf::from(&source_dir);
    let src_toml = src.join("frpc.toml");
    if !src_toml.exists() {
        return Err(AppError::msg(format!(
            "在 {} 找不到 frpc.toml",
            src.display()
        )));
    }
    let text = std::fs::read_to_string(&src_toml)?;

    let mut form = config::parse_to_form(&text)?;
    for proxy in form.proxies.iter_mut() {
        if let Some(pl) = proxy.plugin.as_mut() {
            if let Some(crt) = pl.crt_path.clone() {
                let new_rel = import_cert_file(&src, &crt, &p.certs_dir)?;
                pl.crt_path = Some(new_rel);
            }
            if let Some(key) = pl.key_path.clone() {
                let new_rel = import_cert_file(&src, &key, &p.certs_dir)?;
                pl.key_path = Some(new_rel);
            }
        }
    }
    let new_text = config::form_to_toml(&form)?;
    std::fs::write(&p.default_profile, new_text)?;
    Ok(p.default_profile.to_string_lossy().to_string())
}

fn import_cert_file(base: &std::path::Path, rel_or_abs: &str, certs_dir: &std::path::Path) -> AppResult<String> {
    let src = paths::resolve_relative(base, rel_or_abs);
    if !src.exists() {
        // Nothing to copy; keep original path.
        return Ok(rel_or_abs.to_string());
    }
    let filename = src
        .file_name()
        .ok_or_else(|| AppError::msg(format!("无法解析证书文件名: {}", src.display())))?;
    let dest = certs_dir.join(filename);
    std::fs::create_dir_all(certs_dir)?;
    if src.canonicalize().ok() != dest.canonicalize().ok() {
        std::fs::copy(&src, &dest)?;
    }
    Ok(format!("./certs/{}", filename.to_string_lossy()))
}

// ------------------- config -------------------

#[tauri::command]
pub async fn config_load(app: AppHandle) -> AppResult<String> {
    let p = paths::ensure_app_dirs(&app)?;
    if !p.default_profile.exists() {
        // Return a template so the UI has something to show.
        return Ok(String::from(
            "serverAddr = \"\"\nserverPort = 7000\n",
        ));
    }
    Ok(std::fs::read_to_string(&p.default_profile)?)
}

#[tauri::command]
pub async fn config_save(app: AppHandle, toml_text: String) -> AppResult<()> {
    let p = paths::ensure_app_dirs(&app)?;
    config::validate(&toml_text)?;
    std::fs::write(&p.default_profile, toml_text)?;
    Ok(())
}

#[tauri::command]
pub async fn config_parse_to_form(toml_text: String) -> AppResult<config::FrpcForm> {
    config::parse_to_form(&toml_text)
}

#[tauri::command]
pub async fn config_form_to_doc(form: config::FrpcForm) -> AppResult<String> {
    config::form_to_toml(&form)
}

#[tauri::command]
pub async fn config_validate(toml_text: String) -> AppResult<()> {
    config::validate(&toml_text)
}

#[tauri::command]
pub async fn cert_pick_and_import(app: AppHandle, src_path: String) -> AppResult<String> {
    let p = paths::ensure_app_dirs(&app)?;
    let src = PathBuf::from(&src_path);
    if !src.exists() {
        return Err(AppError::msg(format!("文件不存在: {src_path}")));
    }
    let filename = src
        .file_name()
        .ok_or_else(|| AppError::msg("无法解析文件名"))?;
    let dest = p.certs_dir.join(filename);
    std::fs::create_dir_all(&p.certs_dir)?;
    if src.canonicalize().ok() != dest.canonicalize().ok() {
        std::fs::copy(&src, &dest)?;
    }
    Ok(format!("./certs/{}", filename.to_string_lossy()))
}

// ------------------- frpc download -------------------

#[tauri::command]
pub async fn frpc_list_versions(app: AppHandle, mirror: Option<String>) -> AppResult<Vec<frpc::VersionEntry>> {
    let p = paths::ensure_app_dirs(&app)?;
    let installed = frpc::list_installed_versions(&p.bin_dir)?;
    frpc::list_versions(&installed, mirror.as_deref()).await
}

#[tauri::command]
pub async fn frpc_install(
    app: AppHandle,
    version: String,
    url: String,
    mirror: Option<String>,
) -> AppResult<PathBuf> {
    let p = paths::ensure_app_dirs(&app)?;
    frpc::install_version(&app, &p, &version, &url, mirror.as_deref()).await
}

#[tauri::command]
pub async fn frpc_current_version(app: AppHandle) -> AppResult<Option<String>> {
    let p = paths::ensure_app_dirs(&app)?;
    frpc::current_version(&p.current_link).await
}

// ------------------- runner -------------------

#[tauri::command]
pub async fn runner_start(app: AppHandle, state: State<'_, AppState>) -> AppResult<RunnerStatus> {
    let p = paths::ensure_app_dirs(&app)?;
    runner::process::start(
        &app,
        state.runner.clone(),
        &p.current_link,
        &p.default_profile,
        &p.data_dir,
        &p.log_file,
    )
    .await
}

#[tauri::command]
pub async fn runner_stop(app: AppHandle, state: State<'_, AppState>) -> AppResult<RunnerStatus> {
    runner::process::stop(&app, state.runner.clone()).await
}

#[tauri::command]
pub async fn runner_status(state: State<'_, AppState>) -> AppResult<RunnerStatus> {
    Ok(runner::process::status(state.runner.clone()).await)
}

#[tauri::command]
pub async fn runner_tail_log(app: AppHandle, lines: Option<usize>) -> AppResult<Vec<String>> {
    let p = paths::ensure_app_dirs(&app)?;
    runner::process::tail_log(&p.log_file, lines.unwrap_or(500)).await
}

// ------------------- launchd -------------------

#[tauri::command]
pub async fn launchd_status() -> AppResult<LaunchdStatus> {
    runner::launchd::status()
}

#[tauri::command]
pub async fn launchd_enable(app: AppHandle, state: State<'_, AppState>) -> AppResult<LaunchdStatus> {
    let p = paths::ensure_app_dirs(&app)?;
    // Stop the in-app subprocess to avoid double-run.
    let _ = runner::process::stop(&app, state.runner.clone()).await;
    runner::launchd::enable(&p.current_link, &p.default_profile, &p.data_dir, &p.log_file)
}

#[tauri::command]
pub async fn launchd_disable() -> AppResult<LaunchdStatus> {
    runner::launchd::disable()
}

