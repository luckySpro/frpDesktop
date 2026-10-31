//! Run frpc as a per-user system service so it keeps running without the app:
//! macOS LaunchAgent (launchd) and Linux systemd user unit. Windows has no
//! equivalent here; the UI offers "launch frpDesktop at login + start frpc".

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonStatus {
    /// launchd | systemd | unsupported
    pub kind: &'static str,
    pub supported: bool,
    pub installed: bool,
    pub loaded: bool,
    pub unit_path: Option<PathBuf>,
    /// frpc binary the installed service points to.
    pub binary: Option<String>,
}

#[cfg_attr(not(any(target_os = "macos", target_os = "linux")), allow(dead_code))]
pub struct DaemonSpec<'a> {
    pub bin: &'a Path,
    pub profile: &'a Path,
    pub cwd: &'a Path,
    pub log_file: &'a Path,
}

#[cfg_attr(not(any(target_os = "macos", target_os = "linux")), allow(dead_code))]
fn run(cmd: &str, args: &[&str]) -> AppResult<std::process::Output> {
    std::process::Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| AppError::msg(format!("执行 {cmd} 失败: {e}")))
}

// ------------------------------------------------------------------ macOS

#[cfg(target_os = "macos")]
mod imp {
    use super::*;

    /// Kept from v0.1.x so existing LaunchAgents are found and replaced.
    pub const LABEL: &str = "com.ueware.frpdesktop.frpc";

    pub fn unit_path() -> AppResult<PathBuf> {
        let home = dirs::home_dir().ok_or_else(|| AppError::msg("找不到用户 HOME 目录"))?;
        Ok(home
            .join("Library/LaunchAgents")
            .join(format!("{LABEL}.plist")))
    }

    fn domain() -> String {
        // SAFETY: getuid has no preconditions and cannot fail.
        format!("gui/{}", unsafe { libc::getuid() })
    }

    pub fn status() -> AppResult<DaemonStatus> {
        let path = unit_path()?;
        let installed = path.exists();
        let loaded = installed
            && run("launchctl", &["print", &format!("{}/{LABEL}", domain())])
                .map(|o| o.status.success())
                .unwrap_or(false);
        let binary = installed
            .then(|| plist::Value::from_file(&path).ok())
            .flatten()
            .and_then(|v| {
                v.as_dictionary()?
                    .get("ProgramArguments")?
                    .as_array()?
                    .first()?
                    .as_string()
                    .map(String::from)
            });
        Ok(DaemonStatus {
            kind: "launchd",
            supported: true,
            installed,
            loaded,
            unit_path: Some(path),
            binary,
        })
    }

    pub fn enable(spec: &DaemonSpec) -> AppResult<DaemonStatus> {
        use plist::Value;
        let path = unit_path()?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut dict = plist::Dictionary::new();
        dict.insert("Label".into(), Value::String(LABEL.into()));
        dict.insert(
            "ProgramArguments".into(),
            Value::Array(vec![
                Value::String(spec.bin.to_string_lossy().into()),
                Value::String("-c".into()),
                Value::String(spec.profile.to_string_lossy().into()),
            ]),
        );
        dict.insert(
            "WorkingDirectory".into(),
            Value::String(spec.cwd.to_string_lossy().into()),
        );
        dict.insert("RunAtLoad".into(), Value::Boolean(true));
        // Restart only on failure, and not in a tight loop.
        let mut keep = plist::Dictionary::new();
        keep.insert("SuccessfulExit".into(), Value::Boolean(false));
        dict.insert("KeepAlive".into(), Value::Dictionary(keep));
        dict.insert("ThrottleInterval".into(), Value::Integer(10.into()));
        dict.insert(
            "StandardOutPath".into(),
            Value::String(spec.log_file.to_string_lossy().into()),
        );
        dict.insert(
            "StandardErrorPath".into(),
            Value::String(spec.log_file.to_string_lossy().into()),
        );

        let _ = run("launchctl", &["bootout", &format!("{}/{LABEL}", domain())]);
        let tmp = path.with_extension("plist.tmp");
        plist::to_file_xml(&tmp, &Value::Dictionary(dict))?;
        std::fs::rename(&tmp, &path)?;
        let p = path.to_string_lossy().to_string();
        let out = run("launchctl", &["bootstrap", &domain(), &p])?;
        if !out.status.success() {
            // Older macOS: fall back to the legacy interface.
            let legacy = run("launchctl", &["load", "-w", &p])?;
            if !legacy.status.success() {
                return Err(AppError::msg(format!(
                    "launchctl 加载失败: {}",
                    String::from_utf8_lossy(&out.stderr).trim()
                )));
            }
        }
        status()
    }

    pub fn disable() -> AppResult<DaemonStatus> {
        let path = unit_path()?;
        let _ = run("launchctl", &["bootout", &format!("{}/{LABEL}", domain())]);
        if path.exists() {
            let _ = run("launchctl", &["unload", "-w", &path.to_string_lossy()]);
            std::fs::remove_file(&path)?;
        }
        status()
    }
}

// ------------------------------------------------------------------ Linux

#[cfg(target_os = "linux")]
mod imp {
    use super::*;

    const UNIT: &str = "frpdesktop-frpc.service";

    pub fn unit_path() -> AppResult<PathBuf> {
        let base = dirs::config_dir().ok_or_else(|| AppError::msg("找不到用户配置目录"))?;
        Ok(base.join("systemd/user").join(UNIT))
    }

    /// systemd unit values: quote and escape so paths with spaces work.
    fn quote(p: &Path) -> String {
        let s = p
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        format!("\"{s}\"")
    }

    pub fn status() -> AppResult<DaemonStatus> {
        let path = unit_path()?;
        let installed = path.exists();
        let loaded = installed
            && run("systemctl", &["--user", "is-active", "--quiet", UNIT])
                .map(|o| o.status.success())
                .unwrap_or(false);
        let binary = std::fs::read_to_string(&path).ok().and_then(|t| {
            t.lines()
                .find_map(|l| l.strip_prefix("ExecStart="))
                .and_then(|l| l.trim().strip_prefix('"'))
                .and_then(|l| l.split('"').next())
                .map(String::from)
        });
        Ok(DaemonStatus {
            kind: "systemd",
            supported: true,
            installed,
            loaded,
            unit_path: Some(path),
            binary,
        })
    }

    pub fn enable(spec: &DaemonSpec) -> AppResult<DaemonStatus> {
        let path = unit_path()?;
        let unit = format!(
            "[Unit]\nDescription=frpc (managed by frpDesktop)\nAfter=network-online.target\n\n\
             [Service]\nType=simple\nWorkingDirectory={cwd}\nExecStart={bin} -c {profile}\n\
             Restart=on-failure\nRestartSec=10\nStandardOutput=append:{log}\nStandardError=append:{log}\n\n\
             [Install]\nWantedBy=default.target\n",
            cwd = quote(spec.cwd),
            bin = quote(spec.bin),
            profile = quote(spec.profile),
            log = spec.log_file.to_string_lossy(),
        );
        crate::fsutil::atomic_write(&path, unit.as_bytes(), false)?;
        let _ = run("systemctl", &["--user", "daemon-reload"]);
        let out = run("systemctl", &["--user", "enable", "--now", UNIT])?;
        if !out.status.success() {
            return Err(AppError::msg(format!(
                "systemctl --user enable 失败: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        let _ = run("systemctl", &["--user", "restart", UNIT]);
        status()
    }

    pub fn disable() -> AppResult<DaemonStatus> {
        let path = unit_path()?;
        let _ = run("systemctl", &["--user", "disable", "--now", UNIT]);
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        let _ = run("systemctl", &["--user", "daemon-reload"]);
        status()
    }
}

// ------------------------------------------------------------------ other

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod imp {
    use super::*;

    pub fn status() -> AppResult<DaemonStatus> {
        Ok(DaemonStatus {
            kind: "unsupported",
            supported: false,
            installed: false,
            loaded: false,
            unit_path: None,
            binary: None,
        })
    }

    pub fn enable(_spec: &DaemonSpec) -> AppResult<DaemonStatus> {
        Err(AppError::msg(
            "当前系统不支持后台服务，请使用「登录时启动 frpDesktop」+「启动后自动运行 frpc」",
        ))
    }

    pub fn disable() -> AppResult<DaemonStatus> {
        status()
    }
}

pub use imp::{disable, enable, status};
