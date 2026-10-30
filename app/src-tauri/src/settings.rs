//! App-level preferences persisted as JSON in the data directory.
//!
//! These are frpDesktop's own settings (mirror, auto restart, theme …), not
//! frpc configuration. The file is written atomically and unknown / broken
//! content falls back to defaults so a bad edit never blocks startup.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::fsutil;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// GitHub download mirror prefix, e.g. `https://gh-proxy.com/`.
    pub mirror_prefix: String,
    /// Installed frpc version selected as active (e.g. `0.65.0`).
    pub frpc_version: Option<String>,
    /// Use an external frpc binary instead of a managed one.
    pub frpc_custom_path: Option<String>,
    /// Restart frpc automatically when it exits unexpectedly.
    pub auto_restart: bool,
    /// Start frpc as soon as frpDesktop launches.
    pub start_frpc_on_launch: bool,
    /// Public HTTPS port of frps (vhostHTTPSPort), used to build access links.
    pub https_port: u16,
    /// Public HTTP port of frps (vhostHTTPPort), used to build access links.
    pub http_port: u16,
    /// system | light | dark
    pub theme: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            mirror_prefix: String::new(),
            frpc_version: None,
            frpc_custom_path: None,
            auto_restart: true,
            start_frpc_on_launch: false,
            https_port: 443,
            http_port: 80,
            theme: "system".into(),
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Settings {
        match std::fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                tracing::warn!("settings.json 解析失败，使用默认值: {e}");
                Settings::default()
            }),
            Err(_) => Settings::default(),
        }
    }

    pub fn save(&self, path: &Path) -> AppResult<()> {
        let text = serde_json::to_string_pretty(self)?;
        fsutil::atomic_write(path, text.as_bytes(), false)
    }

    /// Normalise user input before persisting.
    pub fn sanitized(mut self) -> AppResult<Settings> {
        let m = self.mirror_prefix.trim().to_string();
        if !m.is_empty() && !m.starts_with("https://") {
            return Err(crate::error::AppError::msg("镜像前缀必须以 https:// 开头"));
        }
        self.mirror_prefix = m;
        if !matches!(self.theme.as_str(), "system" | "light" | "dark") {
            self.theme = "system".into();
        }
        if self.https_port == 0 {
            self.https_port = 443;
        }
        if self.http_port == 0 {
            self.http_port = 80;
        }
        self.frpc_custom_path = self
            .frpc_custom_path
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_use_defaults() {
        let s: Settings = serde_json::from_str(r#"{"mirrorPrefix":"https://x/"}"#).unwrap();
        assert_eq!(s.mirror_prefix, "https://x/");
        assert!(s.auto_restart);
        assert_eq!(s.https_port, 443);
    }

    #[test]
    fn rejects_plain_http_mirror() {
        let s = Settings {
            mirror_prefix: "http://evil/".into(),
            ..Default::default()
        };
        assert!(s.sanitized().is_err());
    }
}
