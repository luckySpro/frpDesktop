//! Resolve and ensure application data directories.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub bin_dir: PathBuf,
    pub current_link: PathBuf,
    pub profiles_dir: PathBuf,
    pub default_profile: PathBuf,
    pub certs_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub log_file: PathBuf,
}

pub fn resolve(app: &AppHandle) -> AppResult<AppPaths> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::msg(format!("resolve app_data_dir: {e}")))?;
    let bin_dir = data_dir.join("bin");
    let profiles_dir = data_dir.join("profiles");
    let certs_dir = data_dir.join("certs");
    let logs_dir = data_dir.join("logs");
    Ok(AppPaths {
        current_link: bin_dir.join("current"),
        default_profile: profiles_dir.join("default.toml"),
        log_file: logs_dir.join("frpc.log"),
        data_dir,
        bin_dir,
        profiles_dir,
        certs_dir,
        logs_dir,
    })
}

pub fn ensure_app_dirs(app: &AppHandle) -> AppResult<AppPaths> {
    let p = resolve(app)?;
    for d in [&p.data_dir, &p.bin_dir, &p.profiles_dir, &p.certs_dir, &p.logs_dir] {
        if !d.exists() {
            std::fs::create_dir_all(d)?;
        }
    }
    Ok(p)
}

/// Resolve a relative path against a base directory. Absolute inputs are returned as-is.
pub fn resolve_relative(base: &Path, p: &str) -> PathBuf {
    let pb = PathBuf::from(p);
    if pb.is_absolute() {
        pb
    } else {
        base.join(pb)
    }
}
