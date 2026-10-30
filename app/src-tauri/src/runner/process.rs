//! frpc subprocess supervision with log streaming and optional auto restart.
//!
//! Ownership model:
//! - The spawned `Child` is owned exclusively by a supervisor task.
//! - The shared `Runner` holds only the public status and a `oneshot::Sender`
//!   used to ask the supervisor to stop.
//! - `stop()` takes the sender out of the state and releases the lock before
//!   signalling, so the supervisor can update the state without deadlocking.
//! - When frpc exits on its own and auto restart is on, the supervisor waits
//!   with exponential backoff and starts it again. The attempt counter resets
//!   once frpc has stayed up for `STABLE_AFTER`.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};

use crate::error::{AppError, AppResult};

const MAX_RESTARTS: u32 = 5;
const STABLE_AFTER: Duration = Duration::from_secs(60);
const LOG_ROTATE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum RunnerStatus {
    Stopped,
    Starting,
    Running {
        pid: u32,
        since: DateTime<Utc>,
        restarts: u32,
    },
    Restarting {
        attempt: u32,
        delay_secs: u64,
        code: Option<i32>,
    },
    Exited {
        code: Option<i32>,
        at: DateTime<Utc>,
    },
}

pub struct Runner {
    pub status: RunnerStatus,
    stop_tx: Option<oneshot::Sender<()>>,
}

impl Default for Runner {
    fn default() -> Self {
        Self {
            status: RunnerStatus::Stopped,
            stop_tx: None,
        }
    }
}

pub type SharedRunner = Arc<Mutex<Runner>>;

#[derive(Debug, Clone)]
pub struct StartSpec {
    pub bin: PathBuf,
    pub profile: PathBuf,
    pub cwd: PathBuf,
    pub log_file: PathBuf,
    pub auto_restart: bool,
}

/// Do not flash a console window for frpc on Windows.
pub fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

fn set_status(app: &AppHandle, r: &mut Runner, s: RunnerStatus) {
    r.status = s;
    let _ = app.emit("frpc://status", &r.status);
}

fn system_log(app: &AppHandle, line: impl Into<String>) {
    let _ = app.emit(
        "frpc://log",
        serde_json::json!({ "stream": "system", "line": line.into() }),
    );
}

fn rotate_log(log_file: &Path) {
    if let Ok(m) = std::fs::metadata(log_file) {
        if m.len() > LOG_ROTATE_BYTES {
            let _ = std::fs::rename(log_file, log_file.with_extension("log.1"));
        }
    }
}

fn spawn_child(spec: &StartSpec) -> AppResult<tokio::process::Child> {
    let mut cmd = Command::new(&spec.bin);
    cmd.arg("-c")
        .arg(&spec.profile)
        .current_dir(&spec.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    hide_console(&mut cmd);
    cmd.spawn()
        .map_err(|e| AppError::msg(format!("启动 frpc 失败: {e} ({})", spec.bin.display())))
}

pub async fn start(
    app: &AppHandle,
    state: SharedRunner,
    spec: StartSpec,
) -> AppResult<RunnerStatus> {
    if !spec.bin.is_file() {
        return Err(AppError::msg(
            "尚未安装 frpc，请先在「设置」中下载或指定 frpc",
        ));
    }
    if !spec.profile.is_file() {
        return Err(AppError::msg("还没有配置文件，请先在「代理」页保存配置"));
    }

    let stop_rx = {
        let mut guard = state.lock().await;
        if matches!(
            guard.status,
            RunnerStatus::Running { .. } | RunnerStatus::Starting | RunnerStatus::Restarting { .. }
        ) {
            return Ok(guard.status.clone());
        }
        let (tx, rx) = oneshot::channel();
        guard.stop_tx = Some(tx);
        set_status(app, &mut guard, RunnerStatus::Starting);
        rx
    };

    rotate_log(&spec.log_file);
    let first = match spawn_child(&spec) {
        Ok(c) => c,
        Err(e) => {
            let mut guard = state.lock().await;
            guard.stop_tx = None;
            set_status(app, &mut guard, RunnerStatus::Stopped);
            return Err(e);
        }
    };

    let app2 = app.clone();
    let state2 = state.clone();
    tauri::async_runtime::spawn(supervise(app2, state2, spec, first, stop_rx));

    // Report the state right after the first spawn.
    let guard = state.lock().await;
    Ok(guard.status.clone())
}

async fn supervise(
    app: AppHandle,
    state: SharedRunner,
    spec: StartSpec,
    first: tokio::process::Child,
    mut stop_rx: oneshot::Receiver<()>,
) {
    let mut child = Some(first);
    let mut attempt: u32 = 0;
    let mut restarts: u32 = 0;

    loop {
        let mut c = match child.take() {
            Some(c) => c,
            None => match spawn_child(&spec) {
                Ok(c) => c,
                Err(e) => {
                    system_log(&app, format!("[frpDesktop] {e}"));
                    let mut g = state.lock().await;
                    g.stop_tx = None;
                    set_status(
                        &app,
                        &mut g,
                        RunnerStatus::Exited {
                            code: None,
                            at: Utc::now(),
                        },
                    );
                    return;
                }
            },
        };
        let pid = c.id().unwrap_or(0);
        let since = Utc::now();
        if let Some(out) = c.stdout.take() {
            spawn_log_stream(app.clone(), out, spec.log_file.clone(), "stdout");
        }
        if let Some(err) = c.stderr.take() {
            spawn_log_stream(app.clone(), err, spec.log_file.clone(), "stderr");
        }
        {
            let mut g = state.lock().await;
            set_status(
                &app,
                &mut g,
                RunnerStatus::Running {
                    pid,
                    since,
                    restarts,
                },
            );
        }

        let code = tokio::select! {
            _ = &mut stop_rx => {
                let _ = c.start_kill();
                let _ = c.wait().await;
                let mut g = state.lock().await;
                g.stop_tx = None;
                set_status(&app, &mut g, RunnerStatus::Stopped);
                system_log(&app, "[frpDesktop] frpc 已停止");
                return;
            }
            s = c.wait() => s.ok().and_then(|s| s.code()),
        };

        if (Utc::now() - since).to_std().unwrap_or_default() >= STABLE_AFTER {
            attempt = 0;
        }
        system_log(
            &app,
            format!(
                "[frpDesktop] frpc 退出，code={}",
                code.map(|c| c.to_string())
                    .unwrap_or_else(|| "signal".into())
            ),
        );

        if !spec.auto_restart || attempt >= MAX_RESTARTS {
            if spec.auto_restart {
                system_log(&app, format!("[frpDesktop] 已连续重启 {MAX_RESTARTS} 次仍失败，停止自动重启，请检查配置和日志"));
            }
            let mut g = state.lock().await;
            g.stop_tx = None;
            set_status(
                &app,
                &mut g,
                RunnerStatus::Exited {
                    code,
                    at: Utc::now(),
                },
            );
            return;
        }

        attempt += 1;
        restarts += 1;
        let delay = 2u64.pow(attempt.min(5)); // 2,4,8,16,32s
        {
            let mut g = state.lock().await;
            set_status(
                &app,
                &mut g,
                RunnerStatus::Restarting {
                    attempt,
                    delay_secs: delay,
                    code,
                },
            );
        }
        system_log(
            &app,
            format!("[frpDesktop] {delay} 秒后自动重启（第 {attempt}/{MAX_RESTARTS} 次）"),
        );
        tokio::select! {
            _ = &mut stop_rx => {
                let mut g = state.lock().await;
                g.stop_tx = None;
                set_status(&app, &mut g, RunnerStatus::Stopped);
                return;
            }
            _ = tokio::time::sleep(Duration::from_secs(delay)) => {}
        }
    }
}

/// Strip ANSI colour escapes that frp writes to the console.
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for n in chars.by_ref() {
                    if n.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

fn spawn_log_stream<R>(app: AppHandle, reader: R, log_file: PathBuf, stream_name: &'static str)
where
    R: tokio::io::AsyncRead + Send + Unpin + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file)
            .await
            .ok();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = strip_ansi(&line);
            let _ = app.emit(
                "frpc://log",
                serde_json::json!({ "stream": stream_name, "line": line }),
            );
            if let Some(f) = file.as_mut() {
                let _ = f
                    .write_all(format!("[{stream_name}] {line}\n").as_bytes())
                    .await;
            }
        }
    });
}

/// Ask the supervisor to stop frpc and wait (up to ~5 s) for it to finish.
pub async fn stop(app: &AppHandle, state: SharedRunner) -> AppResult<RunnerStatus> {
    let sender = state.lock().await.stop_tx.take();
    match sender {
        Some(tx) => {
            let _ = tx.send(());
        }
        None => {
            let mut g = state.lock().await;
            if !matches!(g.status, RunnerStatus::Stopped) {
                set_status(app, &mut g, RunnerStatus::Stopped);
            }
            return Ok(g.status.clone());
        }
    }
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let g = state.lock().await;
        if matches!(
            g.status,
            RunnerStatus::Stopped | RunnerStatus::Exited { .. }
        ) {
            return Ok(g.status.clone());
        }
    }
    Ok(state.lock().await.status.clone())
}

pub async fn status(state: SharedRunner) -> RunnerStatus {
    state.lock().await.status.clone()
}

/// Last `lines` lines of the log file (reads at most the last 1 MB).
pub async fn tail_log(log_file: &Path, lines: usize) -> AppResult<Vec<String>> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let Ok(mut f) = tokio::fs::File::open(log_file).await else {
        return Ok(Vec::new());
    };
    let len = f.metadata().await?.len();
    let window = 1024 * 1024;
    let start = len.saturating_sub(window);
    f.seek(std::io::SeekFrom::Start(start)).await?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).await?;
    let text = String::from_utf8_lossy(&buf);
    let mut all: Vec<&str> = text.lines().collect();
    if start > 0 && !all.is_empty() {
        all.remove(0); // partial first line
    }
    let from = all.len().saturating_sub(lines);
    Ok(all[from..].iter().map(|s| strip_ansi(s)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_colour_codes() {
        assert_eq!(
            strip_ansi("\u{1b}[1;34m2025 [I]\u{1b}[0m start proxy success"),
            "2025 [I] start proxy success"
        );
        assert_eq!(strip_ansi("plain"), "plain");
    }
}
