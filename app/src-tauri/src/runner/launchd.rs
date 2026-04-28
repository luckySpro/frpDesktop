//! launchd (LaunchAgent) integration for "login launch / keep alive".

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const LABEL: &str = "com.ueware.frpdesktop.frpc";

#[derive(Debug, Clone, Serialize)]
pub struct LaunchdStatus {
    pub installed: bool,
    pub loaded: bool,
    pub plist_path: PathBuf,
}

pub fn plist_path() -> AppResult<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| AppError::msg("找不到用户 HOME 目录"))?;
    Ok(home
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{LABEL}.plist")))
}

pub fn status() -> AppResult<LaunchdStatus> {
    let path = plist_path()?;
    let installed = path.exists();
    let loaded = if installed {
        let out = std::process::Command::new("launchctl").arg("list").output();
        match out {
            Ok(o) if o.status.success() => {
                String::from_utf8_lossy(&o.stdout).lines().any(|l| l.contains(LABEL))
            }
            _ => false,
        }
    } else {
        false
    };
    Ok(LaunchdStatus {
        installed,
        loaded,
        plist_path: path,
    })
}

pub fn enable(frpc_bin: &Path, profile: &Path, cwd: &Path, log_file: &Path) -> AppResult<LaunchdStatus> {
    let path = plist_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let dict = make_plist(frpc_bin, profile, cwd, log_file)?;
    let mut file = std::fs::File::create(&path)?;
    plist::to_writer_xml(&mut file, &dict)?;

    // Try to unload first (ignore error), then load.
    let _ = std::process::Command::new("launchctl")
        .args(["unload", "-w"])
        .arg(&path)
        .output();
    let load = std::process::Command::new("launchctl")
        .args(["load", "-w"])
        .arg(&path)
        .output()?;
    if !load.status.success() {
        return Err(AppError::msg(format!(
            "launchctl load 失败: {}",
            String::from_utf8_lossy(&load.stderr)
        )));
    }
    status()
}

pub fn disable() -> AppResult<LaunchdStatus> {
    let path = plist_path()?;
    if path.exists() {
        let _ = std::process::Command::new("launchctl")
            .args(["unload", "-w"])
            .arg(&path)
            .output();
        let _ = std::fs::remove_file(&path);
    }
    status()
}

fn make_plist(frpc_bin: &Path, profile: &Path, cwd: &Path, log_file: &Path) -> AppResult<plist::Value> {
    use plist::Value;
    let mut dict = plist::Dictionary::new();
    dict.insert("Label".into(), Value::String(LABEL.into()));
    let args = vec![
        Value::String(frpc_bin.to_string_lossy().to_string()),
        Value::String("-c".into()),
        Value::String(profile.to_string_lossy().to_string()),
    ];
    dict.insert("ProgramArguments".into(), Value::Array(args));
    dict.insert("WorkingDirectory".into(), Value::String(cwd.to_string_lossy().to_string()));
    dict.insert("RunAtLoad".into(), Value::Boolean(true));
    dict.insert("KeepAlive".into(), Value::Boolean(true));
    dict.insert("StandardOutPath".into(), Value::String(log_file.to_string_lossy().to_string()));
    dict.insert("StandardErrorPath".into(), Value::String(log_file.to_string_lossy().to_string()));
    Ok(Value::Dictionary(dict))
}
