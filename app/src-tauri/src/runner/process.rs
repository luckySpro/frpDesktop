//! frpc subprocess management with log streaming.
//!
//! Ownership model:
//! - The spawned `Child` is owned EXCLUSIVELY by the watcher task.
//! - The shared `RunnerState` holds only lightweight metadata (pid, since,
//!   and a `oneshot::Sender` used to ask the watcher to kill the child).
//! - `stop()` takes the sender out of state and drops the lock immediately,
//!   then signals the watcher. The watcher kills the child and updates state.
//!   This avoids any deadlock between `stop()` and the watcher waiting on
//!   `child.wait()` while holding the state lock.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum RunnerStatus {
    Stopped,
    Starting,
    Running { pid: u32, since: DateTime<Utc> },
    Exited { code: Option<i32>, at: DateTime<Utc> },
}

pub enum RunnerState {
    Stopped,
    Starting,
    Running {
        pid: u32,
        since: DateTime<Utc>,
        stop_tx: Option<oneshot::Sender<()>>,
    },
    Exited {
        code: Option<i32>,
        at: DateTime<Utc>,
    },
}

impl RunnerState {
    pub fn to_status(&self) -> RunnerStatus {
        match self {
            RunnerState::Stopped => RunnerStatus::Stopped,
            RunnerState::Starting => RunnerStatus::Starting,
            RunnerState::Running { pid, since, .. } => RunnerStatus::Running {
                pid: *pid,
                since: *since,
            },
            RunnerState::Exited { code, at } => RunnerStatus::Exited {
                code: *code,
                at: *at,
            },
        }
    }
}

pub async fn start(
    app: &AppHandle,
    state: Arc<Mutex<RunnerState>>,
    frpc_bin: &Path,
    profile: &Path,
    cwd: &Path,
    log_file: &Path,
) -> AppResult<RunnerStatus> {
    if !frpc_bin.exists() {
        return Err(AppError::msg(format!(
            "frpc 未安装: {}",
            frpc_bin.display()
        )));
    }
    if !profile.exists() {
        return Err(AppError::msg(format!(
            "配置文件不存在: {}",
            profile.display()
        )));
    }

    {
        let mut guard = state.lock().await;
        if let RunnerState::Running { .. } = &*guard {
            return Ok(guard.to_status());
        }
        *guard = RunnerState::Starting;
        let _ = app.emit("frpc://status", guard.to_status());
    }

    let mut cmd = Command::new(frpc_bin);
    cmd.arg("-c")
        .arg(profile)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        AppError::msg(format!("spawn frpc 失败: {e} ({})", frpc_bin.display()))
    })?;

    let pid = child.id().unwrap_or(0);
    let since = Utc::now();

    // Log streams.
    if let Some(out) = child.stdout.take() {
        spawn_log_stream(app.clone(), out, log_file.to_path_buf(), "stdout");
    }
    if let Some(err) = child.stderr.take() {
        spawn_log_stream(app.clone(), err, log_file.to_path_buf(), "stderr");
    }

    let (stop_tx, stop_rx) = oneshot::channel::<()>();

    {
        let mut guard = state.lock().await;
        *guard = RunnerState::Running {
            pid,
            since,
            stop_tx: Some(stop_tx),
        };
        let _ = app.emit("frpc://status", guard.to_status());
    }

    // Watcher owns the child. It either waits for natural exit or for a stop signal.
    let state_cloned = state.clone();
    let app_cloned = app.clone();
    tokio::spawn(async move {
        let (code, was_killed) = tokio::select! {
            _ = stop_rx => {
                let _ = child.start_kill();
                let s = child.wait().await.ok();
                (s.and_then(|s| s.code()), true)
            }
            s = child.wait() => {
                (s.ok().and_then(|s| s.code()), false)
            }
        };

        let mut guard = state_cloned.lock().await;
        *guard = if was_killed {
            RunnerState::Stopped
        } else {
            RunnerState::Exited {
                code,
                at: Utc::now(),
            }
        };
        let _ = app_cloned.emit("frpc://status", guard.to_status());
        let _ = app_cloned.emit(
            "frpc://log",
            serde_json::json!({
                "stream": "system",
                "line": if was_killed {
                    "[frpc stopped by user]".to_string()
                } else {
                    format!("[frpc exited, code={code:?}]")
                },
            }),
        );
    });

    let guard = state.lock().await;
    Ok(guard.to_status())
}

fn spawn_log_stream<R>(app: AppHandle, reader: R, log_file: PathBuf, stream_name: &'static str)
where
    R: tokio::io::AsyncRead + Send + Unpin + 'static,
{
    tokio::spawn(async move {
        let reader = BufReader::new(reader);
        let mut lines = reader.lines();
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file)
            .await
            .ok();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app.emit(
                "frpc://log",
                serde_json::json!({
                    "stream": stream_name,
                    "line": line,
                }),
            );
            if let Some(f) = file.as_mut() {
                use tokio::io::AsyncWriteExt;
                let _ = f
                    .write_all(format!("[{stream_name}] {line}\n").as_bytes())
                    .await;
            }
        }
    });
}

/// Stop the running frpc by signalling the watcher. Returns the resulting status.
pub async fn stop(app: &AppHandle, state: Arc<Mutex<RunnerState>>) -> AppResult<RunnerStatus> {
    // Take the sender out quickly, then release the lock so the watcher can run.
    let sender = {
        let mut guard = state.lock().await;
        match &mut *guard {
            RunnerState::Running { stop_tx, .. } => stop_tx.take(),
            _ => None,
        }
    };

    if let Some(tx) = sender {
        let _ = tx.send(());
    } else {
        // Not running (or already stopping) — force to Stopped for UI clarity.
        let mut guard = state.lock().await;
        *guard = RunnerState::Stopped;
        let _ = app.emit("frpc://status", guard.to_status());
        return Ok(guard.to_status());
    }

    // Wait up to ~3 seconds for watcher to transition state.
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let guard = state.lock().await;
        if !matches!(&*guard, RunnerState::Running { .. }) {
            return Ok(guard.to_status());
        }
    }
    let guard = state.lock().await;
    Ok(guard.to_status())
}

/// Read current status. No more syscalls here — watcher updates state on its own.
pub async fn status(state: Arc<Mutex<RunnerState>>) -> RunnerStatus {
    let guard = state.lock().await;
    guard.to_status()
}

pub async fn tail_log(log_file: &Path, lines: usize) -> AppResult<Vec<String>> {
    if !log_file.exists() {
        return Ok(Vec::new());
    }
    let content = tokio::fs::read_to_string(log_file).await?;
    let all: Vec<&str> = content.lines().collect();
    let start = all.len().saturating_sub(lines);
    Ok(all[start..].iter().map(|s| s.to_string()).collect())
}
