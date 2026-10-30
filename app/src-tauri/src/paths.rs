//! Resolve and ensure application data directories.
//!
//! Layout (inside the OS app-data dir):
//!   bin/frpc-v<version>[.exe]   managed frpc binaries
//!   bin/current                 legacy symlink from v0.1.x (still honoured)
//!   profiles/default.toml       the frpc config
//!   certs/                      certificate library (`./certs/…` in config)
//!   logs/frpc.log               frpc output
//!   settings.json               frpDesktop preferences
//!
//! frpc runs with `data_dir` as its working directory, so relative paths such
//! as `./certs/a.crt` in the config resolve against it.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::settings::Settings;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub bin_dir: PathBuf,
    pub current_link: PathBuf,
    pub profiles_dir: PathBuf,
    pub default_profile: PathBuf,
    pub certs_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub log_file: PathBuf,
    pub settings_file: PathBuf,
}

impl AppPaths {
    pub fn from_data_dir(data_dir: PathBuf) -> AppPaths {
        let bin_dir = data_dir.join("bin");
        let profiles_dir = data_dir.join("profiles");
        let certs_dir = data_dir.join("certs");
        let logs_dir = data_dir.join("logs");
        AppPaths {
            current_link: bin_dir.join("current"),
            default_profile: profiles_dir.join("default.toml"),
            log_file: logs_dir.join("frpc.log"),
            settings_file: data_dir.join("settings.json"),
            data_dir,
            bin_dir,
            profiles_dir,
            certs_dir,
            logs_dir,
        }
    }

    pub fn settings(&self) -> Settings {
        Settings::load(&self.settings_file)
    }

    /// Path of a managed frpc binary for `version`.
    pub fn managed_binary(&self, version: &str) -> PathBuf {
        self.bin_dir
            .join(format!("frpc-v{version}{}", std::env::consts::EXE_SUFFIX))
    }

    /// The frpc binary that should be run, if any is available:
    /// custom path → selected version → legacy `current` link → newest installed.
    pub fn frpc_binary(&self, s: &Settings) -> Option<PathBuf> {
        if let Some(custom) = s.frpc_custom_path.as_deref() {
            let p = PathBuf::from(custom);
            return p.is_file().then_some(p);
        }
        if let Some(v) = s.frpc_version.as_deref() {
            let p = self.managed_binary(v);
            if p.is_file() {
                return Some(p);
            }
        }
        if self.current_link.is_file() {
            return Some(self.current_link.clone());
        }
        let mut versions = crate::frpc::list_installed_versions(&self.bin_dir).ok()?;
        versions.sort_by(|a, b| crate::frpc::cmp_versions(b, a));
        versions
            .first()
            .map(|v| self.managed_binary(v))
            .filter(|p| p.is_file())
    }

    /// True when `p` is inside the data directory (after canonicalisation).
    pub fn contains(&self, p: &Path) -> bool {
        match (p.canonicalize(), self.data_dir.canonicalize()) {
            (Ok(a), Ok(b)) => a.starts_with(b),
            _ => false,
        }
    }
}

pub fn resolve(app: &AppHandle) -> AppResult<AppPaths> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::msg(format!("resolve app_data_dir: {e}")))?;
    Ok(AppPaths::from_data_dir(data_dir))
}

pub fn ensure_app_dirs(app: &AppHandle) -> AppResult<AppPaths> {
    let p = resolve(app)?;
    for d in [
        &p.data_dir,
        &p.bin_dir,
        &p.profiles_dir,
        &p.certs_dir,
        &p.logs_dir,
    ] {
        if !d.exists() {
            std::fs::create_dir_all(d)?;
        }
    }
    Ok(p)
}
