//! frpc binary download / version management.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::paths;

const GITHUB_API: &str = "https://api.github.com/repos/fatedier/frp/releases";
const UA: &str = "frpDesktop/0.1 (+macOS)";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Release {
    pub tag_name: String,
    pub name: Option<String>,
    pub prerelease: bool,
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionEntry {
    pub tag: String,
    pub version: String,
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
    pub installed: bool,
}

/// darwin_arm64 / darwin_amd64
pub fn detect_arch_slug() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "darwin_arm64",
        "x86_64" => "darwin_amd64",
        _ => "darwin_amd64",
    }
}

/// Normalize a tag "v0.62.1" to "0.62.1".
fn trim_v(tag: &str) -> String {
    tag.strip_prefix('v').unwrap_or(tag).to_string()
}

/// Build the expected asset name, e.g. `frp_0.62.1_darwin_arm64.tar.gz`.
fn asset_name_for(version: &str, arch_slug: &str) -> String {
    format!("frp_{version}_{arch_slug}.tar.gz")
}

pub async fn list_versions(installed: &[String], mirror: Option<&str>) -> AppResult<Vec<VersionEntry>> {
    let base = mirror.map(str::to_string).unwrap_or_else(|| GITHUB_API.to_string());
    let client = reqwest::Client::builder().user_agent(UA).build()?;
    let resp = client
        .get(format!("{base}?per_page=20"))
        .send()
        .await?
        .error_for_status()?;
    let releases: Vec<Release> = resp.json().await?;
    let arch_slug = detect_arch_slug();
    let mut out = Vec::new();
    for r in releases.into_iter().take(15) {
        let version = trim_v(&r.tag_name);
        let want = asset_name_for(&version, arch_slug);
        let asset = r.assets.iter().find(|a| a.name == want);
        out.push(VersionEntry {
            tag: r.tag_name.clone(),
            version: version.clone(),
            asset_name: asset.map(|a| a.name.clone()),
            asset_url: asset.map(|a| a.browser_download_url.clone()),
            installed: installed.iter().any(|v| v == &version),
        });
    }
    Ok(out)
}

pub fn list_installed_versions(bin_dir: &Path) -> AppResult<Vec<String>> {
    let mut out = Vec::new();
    if !bin_dir.exists() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(bin_dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(rest) = name.strip_prefix("frpc-v") {
            out.push(rest.to_string());
        } else if let Some(rest) = name.strip_prefix("frpc-") {
            // allow frpc-0.62.1 as well
            if !rest.is_empty() && rest.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                out.push(rest.to_string());
            }
        }
    }
    Ok(out)
}

pub async fn current_version(bin: &Path) -> AppResult<Option<String>> {
    let target = if bin.exists() {
        bin.to_path_buf()
    } else {
        return Ok(None);
    };
    let output = tokio::process::Command::new(&target)
        .arg("-v")
        .output()
        .await?;
    if !output.status.success() {
        return Ok(None);
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        Ok(None)
    } else {
        Ok(Some(text))
    }
}

/// Download + verify + extract + install.
pub async fn install_version(
    app: &AppHandle,
    paths: &paths::AppPaths,
    version: &str,
    url: &str,
    mirror_prefix: Option<&str>,
) -> AppResult<PathBuf> {
    let final_url = match mirror_prefix {
        Some(m) if !m.is_empty() => format!("{}{}", m.trim_end_matches('/'), url),
        _ => url.to_string(),
    };
    let client = reqwest::Client::builder().user_agent(UA).build()?;

    // Download archive to a temp file.
    let tmp_path = paths.bin_dir.join(format!(".download-{version}.tar.gz"));
    {
        let mut resp = client.get(&final_url).send().await?.error_for_status()?;
        let total = resp.content_length().unwrap_or(0);
        let mut file = tokio::fs::File::create(&tmp_path).await?;
        let mut downloaded: u64 = 0;
        use tokio::io::AsyncWriteExt;
        while let Some(chunk) = resp.chunk().await? {
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;
            let _ = app.emit(
                "frpc://install-progress",
                serde_json::json!({
                    "version": version,
                    "downloaded": downloaded,
                    "total": total,
                }),
            );
        }
        file.flush().await?;
    }

    // Extract frpc into bin/frpc-v{version}
    let target = paths.bin_dir.join(format!("frpc-v{version}"));
    if target.exists() {
        let _ = std::fs::remove_file(&target);
    }
    extract_frpc_from_tar_gz(&tmp_path, &target)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perm = std::fs::metadata(&target)?.permissions();
        perm.set_mode(0o755);
        std::fs::set_permissions(&target, perm)?;
    }

    // Update current symlink.
    #[cfg(unix)]
    {
        let link = &paths.current_link;
        if link.exists() || link.is_symlink() {
            let _ = std::fs::remove_file(link);
        }
        std::os::unix::fs::symlink(&target, link)
            .map_err(|e| AppError::msg(format!("symlink current: {e}")))?;
    }

    let _ = std::fs::remove_file(&tmp_path);
    let _ = app.emit("frpc://install-done", serde_json::json!({ "version": version }));
    Ok(target)
}

fn extract_frpc_from_tar_gz(archive: &Path, dest_binary: &Path) -> AppResult<()> {
    let f = std::fs::File::open(archive)?;
    let gz = flate2::read::GzDecoder::new(f);
    let mut ar = tar::Archive::new(gz);
    for entry in ar.entries()? {
        let mut e = entry?;
        let path = e.path()?.to_path_buf();
        let is_frpc = path
            .file_name()
            .map(|n| n == "frpc")
            .unwrap_or(false);
        if !is_frpc {
            continue;
        }
        if let Some(parent) = dest_binary.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = std::fs::File::create(dest_binary)?;
        std::io::copy(&mut e, &mut out)?;
        return Ok(());
    }
    Err(AppError::msg("archive 中未找到 frpc"))
}
