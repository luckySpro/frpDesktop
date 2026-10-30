//! Tauri command bindings — thin glue over modules. Every command validates
//! its own inputs; the UI hiding a button is never the only guard.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt as _;

use crate::certs::{self, CertFile};
use crate::config::{self, FrpcForm, ValidationReport};
use crate::error::{AppError, AppResult};
use crate::frpc::{self, VersionEntry};
use crate::fsutil;
use crate::paths::{self, AppPaths};
use crate::runner::daemon::{self, DaemonSpec, DaemonStatus};
use crate::runner::process::{self, RunnerStatus, StartSpec};
use crate::settings::Settings;
use crate::AppState;

// ------------------------------------------------------------------ helpers

pub fn start_spec(p: &AppPaths) -> AppResult<StartSpec> {
    let s = p.settings();
    let bin = p
        .frpc_binary(&s)
        .ok_or_else(|| AppError::msg("尚未安装 frpc，请先在「设置」中下载或指定 frpc"))?;
    Ok(StartSpec {
        bin,
        profile: p.default_profile.clone(),
        cwd: p.data_dir.clone(),
        log_file: p.log_file.clone(),
        auto_restart: s.auto_restart,
    })
}

/// Start frpc in-app unless the background service already runs it.
pub async fn start_frpc(app: &AppHandle, state: &AppState) -> AppResult<RunnerStatus> {
    let p = paths::ensure_app_dirs(app)?;
    if daemon::status().map(|d| d.loaded).unwrap_or(false) {
        return Err(AppError::msg(
            "frpc 已作为后台服务运行（设置 → 后台服务）。请先关闭后台服务，避免两个 frpc 同时运行",
        ));
    }
    let spec = start_spec(&p)?;
    process::start(app, state.runner.clone(), spec).await
}

// ------------------------------------------------------------------ app info

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub paths: AppPaths,
    pub profile_exists: bool,
    pub frpc_path: Option<PathBuf>,
    pub frpc_version: Option<String>,
    pub platform: String,
    pub app_version: String,
}

#[tauri::command]
pub async fn app_info(app: AppHandle) -> AppResult<AppInfo> {
    let p = paths::ensure_app_dirs(&app)?;
    let s = p.settings();
    let frpc_path = p.frpc_binary(&s);
    let frpc_version = match &frpc_path {
        Some(b) => frpc::binary_version(b).await,
        None => None,
    };
    Ok(AppInfo {
        profile_exists: p.default_profile.exists(),
        frpc_path,
        frpc_version,
        platform: frpc::platform_slug(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        paths: p,
    })
}

/// Reveal a file / folder of the app data dir (or the service unit) in the
/// system file manager.
#[tauri::command]
pub async fn reveal_path(app: AppHandle, path: String) -> AppResult<()> {
    let p = paths::resolve(&app)?;
    let target = PathBuf::from(&path);
    let unit = daemon::status().ok().and_then(|d| d.unit_path);
    let allowed = p.contains(&target) || unit.as_deref() == Some(target.as_path());
    if !allowed {
        return Err(AppError::msg("只能打开应用数据目录中的文件"));
    }
    let res = if target.is_dir() {
        app.opener()
            .open_path(target.to_string_lossy(), None::<&str>)
    } else {
        app.opener().reveal_item_in_dir(&target)
    };
    res.map_err(|e| AppError::msg(format!("打开失败: {e}")))
}

/// Open an http(s) link (e.g. a proxied site) in the default browser.
#[tauri::command]
pub async fn open_url(app: AppHandle, url: String) -> AppResult<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::msg("只支持 http/https 链接"));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::msg(format!("打开失败: {e}")))
}

// ------------------------------------------------------------------ settings

#[tauri::command]
pub async fn settings_get(app: AppHandle) -> AppResult<Settings> {
    Ok(paths::ensure_app_dirs(&app)?.settings())
}

#[tauri::command]
pub async fn settings_save(app: AppHandle, settings: Settings) -> AppResult<Settings> {
    let p = paths::ensure_app_dirs(&app)?;
    let s = settings.sanitized()?;
    if let Some(custom) = &s.frpc_custom_path {
        let path = Path::new(custom);
        if !path.is_file() {
            return Err(AppError::msg(format!("找不到 frpc: {custom}")));
        }
        if frpc::binary_version(path).await.is_none() {
            return Err(AppError::msg(format!("{custom} 不是可执行的 frpc")));
        }
    }
    s.save(&p.settings_file)?;
    Ok(s)
}

#[tauri::command]
pub async fn autostart_get(app: AppHandle) -> AppResult<bool> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| AppError::msg(format!("读取开机启动状态失败: {e}")))
}

#[tauri::command]
pub async fn autostart_set(app: AppHandle, enabled: bool) -> AppResult<bool> {
    let al = app.autolaunch();
    let r = if enabled { al.enable() } else { al.disable() };
    r.map_err(|e| AppError::msg(format!("设置开机启动失败: {e}")))?;
    al.is_enabled()
        .map_err(|e| AppError::msg(format!("读取开机启动状态失败: {e}")))
}

// ------------------------------------------------------------------ config

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedConfig {
    pub text: String,
    pub exists: bool,
}

#[tauri::command]
pub async fn config_load(app: AppHandle) -> AppResult<LoadedConfig> {
    let p = paths::ensure_app_dirs(&app)?;
    if !p.default_profile.exists() {
        return Ok(LoadedConfig {
            text: config::DEFAULT_TEMPLATE.to_string(),
            exists: false,
        });
    }
    Ok(LoadedConfig {
        text: std::fs::read_to_string(&p.default_profile)?,
        exists: true,
    })
}

#[tauri::command]
pub async fn config_parse(text: String) -> AppResult<FrpcForm> {
    config::parse_to_form(&text)
}

/// Apply form edits onto the original text without losing anything else.
#[tauri::command]
pub async fn config_render(original: String, form: FrpcForm) -> AppResult<String> {
    config::apply_form(&original, &form)
}

fn full_check(p: &AppPaths, text: &str) -> AppResult<ValidationReport> {
    let form = config::parse_to_form(text)?;
    let mut report = config::validate_form(&form);
    report.issues.extend(certs::check_form(&form, &p.data_dir));
    report.ok = report.first_error().is_none();
    Ok(report)
}

#[tauri::command]
pub async fn config_check(app: AppHandle, text: String) -> AppResult<ValidationReport> {
    let p = paths::ensure_app_dirs(&app)?;
    full_check(&p, &text)
}

/// Save the config. With errors the file is left untouched unless `force`.
#[tauri::command]
pub async fn config_save(app: AppHandle, text: String, force: bool) -> AppResult<ValidationReport> {
    let p = paths::ensure_app_dirs(&app)?;
    let report = full_check(&p, &text)?; // TOML syntax errors always block
    if report.ok || force {
        fsutil::atomic_write(&p.default_profile, text.as_bytes(), true)?;
        restrict(&p.default_profile);
    }
    Ok(report)
}

/// The profile holds the auth token; keep it private to the user.
fn restrict(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    pub ok: bool,
    pub output: String,
}

/// Run `frpc verify` against the given text (in the real working directory,
/// so relative certificate paths resolve exactly like at runtime).
#[tauri::command]
pub async fn config_verify(app: AppHandle, text: String) -> AppResult<VerifyResult> {
    let p = paths::ensure_app_dirs(&app)?;
    let bin = p
        .frpc_binary(&p.settings())
        .ok_or_else(|| AppError::msg("尚未安装 frpc，无法执行 frpc verify"))?;
    let tmp = p.profiles_dir.join(".verify.toml");
    fsutil::atomic_write(&tmp, text.as_bytes(), false)?;
    restrict(&tmp);
    let mut cmd = tokio::process::Command::new(&bin);
    cmd.arg("verify")
        .arg("-c")
        .arg(&tmp)
        .current_dir(&p.data_dir);
    process::hide_console(&mut cmd);
    let out = tokio::time::timeout(std::time::Duration::from_secs(15), cmd.output()).await;
    let _ = std::fs::remove_file(&tmp);
    let out = out
        .map_err(|_| AppError::msg("frpc verify 超时"))?
        .map_err(|e| AppError::msg(format!("执行 frpc verify 失败: {e}")))?;
    let mut output = String::from_utf8_lossy(&out.stdout).to_string();
    output.push_str(&String::from_utf8_lossy(&out.stderr));
    let output =
        process::strip_ansi(output.trim()).replace(&tmp.to_string_lossy().to_string(), "配置");
    Ok(VerifyResult {
        ok: out.status.success(),
        output,
    })
}

/// Import an existing frpc.toml: copies referenced certificates into the
/// library and rewrites crtPath / keyPath to `./certs/<name>`. Returns the
/// imported text and a list of notes (missing files etc.). Not saved yet —
/// the UI shows the result and the user saves it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub text: String,
    pub notes: Vec<String>,
}

#[tauri::command]
pub async fn config_import(app: AppHandle, file: String) -> AppResult<ImportResult> {
    let p = paths::ensure_app_dirs(&app)?;
    let src = PathBuf::from(&file);
    let meta =
        std::fs::metadata(&src).map_err(|e| AppError::msg(format!("无法读取 {file}: {e}")))?;
    if meta.len() > 1024 * 1024 {
        return Err(AppError::msg("配置文件过大"));
    }
    let text = std::fs::read_to_string(&src)?;
    let base = src.parent().unwrap_or(Path::new("."));
    let mut form = config::parse_to_form(&text)?;
    let mut notes = Vec::new();
    for proxy in form.proxies.iter_mut() {
        let Some(pl) = proxy.plugin.as_mut() else {
            continue;
        };
        for slot in [&mut pl.crt_path, &mut pl.key_path] {
            let Some(orig) = slot.clone().filter(|s| !s.trim().is_empty()) else {
                continue;
            };
            let file = fsutil::resolve_relative(base, &orig);
            if file.is_file() {
                match certs::import(&p.certs_dir, &file) {
                    Ok(rel) => *slot = Some(rel),
                    Err(e) => notes.push(format!("{}: {e}", proxy.name)),
                }
            } else {
                notes.push(format!(
                    "{}: 找不到 {orig}，请在证书库导入后重新选择",
                    proxy.name
                ));
            }
        }
    }
    let new_text = config::apply_form(&text, &form)?;
    Ok(ImportResult {
        text: new_text,
        notes,
    })
}

// ------------------------------------------------------------------ certs

#[tauri::command]
pub async fn certs_list(app: AppHandle) -> AppResult<Vec<CertFile>> {
    let p = paths::ensure_app_dirs(&app)?;
    certs::list(&p.certs_dir)
}

#[tauri::command]
pub async fn certs_import(app: AppHandle, files: Vec<String>) -> AppResult<Vec<String>> {
    let p = paths::ensure_app_dirs(&app)?;
    files
        .iter()
        .map(|f| certs::import(&p.certs_dir, Path::new(f)))
        .collect()
}

#[tauri::command]
pub async fn certs_delete(app: AppHandle, file_name: String) -> AppResult<()> {
    let p = paths::ensure_app_dirs(&app)?;
    certs::delete(&p.certs_dir, &file_name)
}

// ------------------------------------------------------------------ frpc binaries

#[tauri::command]
pub async fn frpc_list_versions(app: AppHandle) -> AppResult<Vec<VersionEntry>> {
    let p = paths::ensure_app_dirs(&app)?;
    let installed = frpc::list_installed_versions(&p.bin_dir)?;
    frpc::list_versions(&installed).await
}

#[tauri::command]
pub async fn frpc_installed(app: AppHandle) -> AppResult<Vec<String>> {
    let p = paths::ensure_app_dirs(&app)?;
    frpc::list_installed_versions(&p.bin_dir)
}

#[tauri::command]
pub async fn frpc_install(app: AppHandle, entry: VersionEntry) -> AppResult<Settings> {
    let p = paths::ensure_app_dirs(&app)?;
    let mut s = p.settings();
    let mirror = s.mirror_prefix.clone();
    frpc::install_version(&app, &p, &entry, Some(mirror.as_str())).await?;
    s.frpc_version = Some(entry.version.clone());
    s.frpc_custom_path = None;
    s.save(&p.settings_file)?;
    refresh_daemon(&p);
    Ok(s)
}

#[tauri::command]
pub async fn frpc_use(app: AppHandle, version: String) -> AppResult<Settings> {
    let p = paths::ensure_app_dirs(&app)?;
    if !frpc::valid_version(&version) || !p.managed_binary(&version).is_file() {
        return Err(AppError::msg(format!("未安装 frpc v{version}")));
    }
    let mut s = p.settings();
    s.frpc_version = Some(version);
    s.frpc_custom_path = None;
    s.save(&p.settings_file)?;
    refresh_daemon(&p);
    Ok(s)
}

#[tauri::command]
pub async fn frpc_uninstall(app: AppHandle, version: String) -> AppResult<()> {
    let p = paths::ensure_app_dirs(&app)?;
    let s = p.settings();
    if s.frpc_version.as_deref() == Some(version.as_str()) && s.frpc_custom_path.is_none() {
        return Err(AppError::msg("不能删除正在使用的版本，请先切换到其他版本"));
    }
    frpc::uninstall_version(&p, &version)
}

/// When the background service is installed, point it at the current binary.
fn refresh_daemon(p: &AppPaths) {
    if let Ok(d) = daemon::status() {
        if d.installed {
            if let Some(bin) = p.frpc_binary(&p.settings()) {
                let _ = daemon::enable(&DaemonSpec {
                    bin: &bin,
                    profile: &p.default_profile,
                    cwd: &p.data_dir,
                    log_file: &p.log_file,
                });
            }
        }
    }
}

// ------------------------------------------------------------------ runner

#[tauri::command]
pub async fn runner_start(app: AppHandle, state: State<'_, AppState>) -> AppResult<RunnerStatus> {
    start_frpc(&app, &state).await
}

#[tauri::command]
pub async fn runner_stop(app: AppHandle, state: State<'_, AppState>) -> AppResult<RunnerStatus> {
    process::stop(&app, state.runner.clone()).await
}

#[tauri::command]
pub async fn runner_restart(app: AppHandle, state: State<'_, AppState>) -> AppResult<RunnerStatus> {
    process::stop(&app, state.runner.clone()).await?;
    start_frpc(&app, &state).await
}

#[tauri::command]
pub async fn runner_status(state: State<'_, AppState>) -> AppResult<RunnerStatus> {
    Ok(process::status(state.runner.clone()).await)
}

#[tauri::command]
pub async fn runner_tail_log(app: AppHandle, lines: Option<usize>) -> AppResult<Vec<String>> {
    let p = paths::ensure_app_dirs(&app)?;
    process::tail_log(&p.log_file, lines.unwrap_or(500).min(5000)).await
}

#[tauri::command]
pub async fn runner_clear_log(app: AppHandle) -> AppResult<()> {
    let p = paths::ensure_app_dirs(&app)?;
    if p.log_file.exists() {
        std::fs::write(&p.log_file, b"")?;
    }
    Ok(())
}

// ------------------------------------------------------------------ daemon

#[tauri::command]
pub async fn daemon_status() -> AppResult<DaemonStatus> {
    daemon::status()
}

#[tauri::command]
pub async fn daemon_enable(app: AppHandle, state: State<'_, AppState>) -> AppResult<DaemonStatus> {
    let p = paths::ensure_app_dirs(&app)?;
    if !p.default_profile.exists() {
        return Err(AppError::msg("请先保存配置"));
    }
    let bin = p
        .frpc_binary(&p.settings())
        .ok_or_else(|| AppError::msg("尚未安装 frpc"))?;
    // Avoid two frpc instances fighting for the same proxies.
    let _ = process::stop(&app, state.runner.clone()).await;
    daemon::enable(&DaemonSpec {
        bin: &bin,
        profile: &p.default_profile,
        cwd: &p.data_dir,
        log_file: &p.log_file,
    })
}

#[tauri::command]
pub async fn daemon_disable() -> AppResult<DaemonStatus> {
    daemon::disable()
}

#[tauri::command]
pub async fn daemon_restart(app: AppHandle) -> AppResult<DaemonStatus> {
    let p = paths::ensure_app_dirs(&app)?;
    let d = daemon::status()?;
    if !d.installed {
        return Err(AppError::msg("后台服务未启用"));
    }
    refresh_daemon(&p);
    daemon::status()
}
