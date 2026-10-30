//! frpc binary download / version management.
//!
//! Release metadata always comes from the GitHub API. The optional mirror
//! prefix (e.g. `https://gh-proxy.com/`) only accelerates the archive and the
//! checksum downloads; integrity is checked against `frp_sha256_checksums.txt`
//! from the same release.

use std::cmp::Ordering;
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::fsutil;
use crate::paths::AppPaths;

const GITHUB_API: &str = "https://api.github.com/repos/fatedier/frp/releases";
const CHECKSUMS_ASSET: &str = "frp_sha256_checksums.txt";
const UA: &str = concat!("frpDesktop/", env!("CARGO_PKG_VERSION"));
/// frp archives are ~10-15 MB; refuse anything absurd.
const MAX_ARCHIVE_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone, Deserialize)]
struct Release {
    tag_name: String,
    prerelease: bool,
    #[serde(default)]
    published_at: Option<String>,
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub tag: String,
    pub version: String,
    pub prerelease: bool,
    pub published_at: Option<String>,
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
    pub checksums_url: Option<String>,
    pub installed: bool,
}

/// `darwin_arm64`, `linux_amd64`, `windows_amd64` …
pub fn platform_slug() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "amd64",
        "x86" => "386",
        "arm" => "arm",
        "riscv64" => "riscv64",
        "loongarch64" => "loong64",
        other => other,
    };
    format!("{os}_{arch}")
}

fn archive_ext() -> &'static str {
    if cfg!(windows) {
        "zip"
    } else {
        "tar.gz"
    }
}

fn trim_v(tag: &str) -> String {
    tag.strip_prefix('v').unwrap_or(tag).to_string()
}

pub fn asset_name_for(version: &str) -> String {
    format!("frp_{version}_{}.{}", platform_slug(), archive_ext())
}

/// Compare dotted numeric versions (`0.10.0` > `0.9.3`).
pub fn cmp_versions(a: &str, b: &str) -> Ordering {
    let parse = |s: &str| -> Vec<u64> {
        s.split(['.', '-'])
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    };
    parse(a).cmp(&parse(b))
}

pub fn valid_version(v: &str) -> bool {
    !v.is_empty()
        && v.len() < 32
        && v.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

fn client() -> AppResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(UA)
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()?)
}

fn with_mirror(mirror: Option<&str>, url: &str) -> String {
    match mirror.map(str::trim).filter(|m| !m.is_empty()) {
        Some(m) => format!("{}/{}", m.trim_end_matches('/'), url),
        None => url.to_string(),
    }
}

pub async fn list_versions(installed: &[String]) -> AppResult<Vec<VersionEntry>> {
    let resp = client()?
        .get(format!("{GITHUB_API}?per_page=20"))
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| {
            AppError::msg(format!(
                "无法访问 GitHub API（{e}）。可在设置中改用自定义 frpc 路径"
            ))
        })?;
    if resp.status() == reqwest::StatusCode::FORBIDDEN {
        return Err(AppError::msg("GitHub API 访问频率受限，请稍后再试"));
    }
    let releases: Vec<Release> = resp.error_for_status()?.json().await?;
    let want_suffix = format!("_{}.{}", platform_slug(), archive_ext());
    Ok(releases
        .into_iter()
        .map(|r| {
            let version = trim_v(&r.tag_name);
            let want = asset_name_for(&version);
            let asset = r
                .assets
                .iter()
                .find(|a| a.name == want)
                .or_else(|| r.assets.iter().find(|a| a.name.ends_with(&want_suffix)));
            let sums = r.assets.iter().find(|a| a.name == CHECKSUMS_ASSET);
            VersionEntry {
                installed: installed.iter().any(|v| v == &version),
                tag: r.tag_name,
                version,
                prerelease: r.prerelease,
                published_at: r.published_at,
                asset_name: asset.map(|a| a.name.clone()),
                asset_url: asset.map(|a| a.browser_download_url.clone()),
                checksums_url: sums.map(|a| a.browser_download_url.clone()),
            }
        })
        .collect())
}

pub fn list_installed_versions(bin_dir: &Path) -> AppResult<Vec<String>> {
    let mut out = Vec::new();
    if !bin_dir.exists() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(bin_dir)? {
        let name = entry?.file_name().to_string_lossy().to_string();
        let name = name.strip_suffix(".exe").unwrap_or(&name);
        if let Some(rest) = name.strip_prefix("frpc-v") {
            if valid_version(rest) {
                out.push(rest.to_string());
            }
        }
    }
    out.sort_by(|a, b| cmp_versions(b, a));
    Ok(out)
}

pub async fn binary_version(bin: &Path) -> Option<String> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.arg("-v");
    crate::runner::process::hide_console(&mut cmd);
    let out = tokio::time::timeout(std::time::Duration::from_secs(5), cmd.output())
        .await
        .ok()?
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !text.is_empty()).then_some(text)
}

fn parse_checksum(sums: &str, asset: &str) -> Option<String> {
    sums.lines().find_map(|l| {
        let mut it = l.split_whitespace();
        let hash = it.next()?;
        let name = it.next()?.trim_start_matches('*');
        (name == asset && hash.len() == 64).then(|| hash.to_ascii_lowercase())
    })
}

/// Only GitHub release URLs are accepted as download sources.
fn check_release_url(url: &str) -> AppResult<()> {
    if url.starts_with("https://github.com/fatedier/frp/releases/download/") {
        Ok(())
    } else {
        Err(AppError::msg(format!("拒绝下载非 frp 官方发布地址: {url}")))
    }
}

/// Download + verify + extract + install. Returns the installed binary path.
pub async fn install_version(
    app: &AppHandle,
    paths: &AppPaths,
    entry: &VersionEntry,
    mirror: Option<&str>,
) -> AppResult<std::path::PathBuf> {
    let version = entry.version.as_str();
    if !valid_version(version) {
        return Err(AppError::msg("版本号无效"));
    }
    let (Some(asset_name), Some(url)) = (entry.asset_name.as_deref(), entry.asset_url.as_deref())
    else {
        return Err(AppError::msg(format!(
            "v{version} 没有 {} 平台的安装包",
            platform_slug()
        )));
    };
    check_release_url(url)?;
    let client = client()?;

    // Checksum list first (small). Missing list → refuse unless the release
    // simply has none (very old frp versions).
    let expected = match entry.checksums_url.as_deref() {
        Some(sums_url) => {
            check_release_url(sums_url)?;
            let text = client
                .get(with_mirror(mirror, sums_url))
                .timeout(std::time::Duration::from_secs(30))
                .send()
                .await?
                .error_for_status()?
                .text()
                .await?;
            Some(parse_checksum(&text, asset_name).ok_or_else(|| {
                AppError::msg(format!(
                    "校验文件中找不到 {asset_name}，可能是镜像返回了错误内容"
                ))
            })?)
        }
        None => None,
    };

    let mut resp = client
        .get(with_mirror(mirror, url))
        .send()
        .await?
        .error_for_status()?;
    let total = resp.content_length().unwrap_or(0);
    if total > MAX_ARCHIVE_BYTES {
        return Err(AppError::msg("下载文件过大"));
    }
    let mut buf: Vec<u8> = Vec::with_capacity(total as usize);
    let mut hasher = Sha256::new();
    let mut last_emit = 0u64;
    while let Some(chunk) = resp.chunk().await? {
        hasher.update(&chunk);
        buf.extend_from_slice(&chunk);
        if buf.len() as u64 > MAX_ARCHIVE_BYTES {
            return Err(AppError::msg("下载文件过大"));
        }
        let downloaded = buf.len() as u64;
        if downloaded - last_emit > 256 * 1024 || downloaded == total {
            last_emit = downloaded;
            let _ = app.emit(
                "frpc://install-progress",
                serde_json::json!({ "version": version, "downloaded": downloaded, "total": total }),
            );
        }
    }
    let actual = hex::encode(hasher.finalize());
    match expected {
        Some(exp) if exp != actual => {
            return Err(AppError::msg(format!(
            "SHA256 校验失败（期望 {exp}，实际 {actual}）。镜像内容可能被篡改，请换镜像或直连重试"
        )))
        }
        Some(_) => {}
        None => tracing::warn!("frp v{version} 没有校验文件，跳过 SHA256 校验"),
    }

    let binary = extract_frpc(&buf, asset_name)?;
    let target = paths.managed_binary(version);
    fsutil::atomic_write(&target, &binary, false)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755))?;
    }
    let _ = app.emit(
        "frpc://install-done",
        serde_json::json!({ "version": version }),
    );
    Ok(target)
}

fn extract_frpc(archive: &[u8], asset_name: &str) -> AppResult<Vec<u8>> {
    let mut out = Vec::new();
    if asset_name.ends_with(".zip") {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive))?;
        for i in 0..zip.len() {
            let f = zip.by_index(i)?;
            let is_frpc = Path::new(f.name())
                .file_name()
                .map(|n| n == "frpc.exe" || n == "frpc")
                .unwrap_or(false);
            if is_frpc && f.is_file() {
                f.take(MAX_ARCHIVE_BYTES).read_to_end(&mut out)?;
                return Ok(out);
            }
        }
    } else {
        let gz = flate2::read::GzDecoder::new(archive);
        let mut ar = tar::Archive::new(gz);
        for entry in ar.entries()? {
            let mut e = entry?;
            let is_frpc = e.path()?.file_name().map(|n| n == "frpc").unwrap_or(false);
            if is_frpc && e.header().entry_type().is_file() {
                (&mut e).take(MAX_ARCHIVE_BYTES).read_to_end(&mut out)?;
                return Ok(out);
            }
        }
    }
    Err(AppError::msg("安装包中未找到 frpc"))
}

pub fn uninstall_version(paths: &AppPaths, version: &str) -> AppResult<()> {
    if !valid_version(version) {
        return Err(AppError::msg("版本号无效"));
    }
    let p = paths.managed_binary(version);
    if p.exists() {
        std::fs::remove_file(p)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_ordering() {
        assert_eq!(cmp_versions("0.10.0", "0.9.9"), Ordering::Greater);
        assert_eq!(cmp_versions("0.65.0", "0.65.0"), Ordering::Equal);
        assert_eq!(cmp_versions("0.61.2", "0.62.0"), Ordering::Less);
    }

    #[test]
    fn mirror_prefix_keeps_separator() {
        assert_eq!(
            with_mirror(Some("https://gh-proxy.com/"), "https://github.com/x"),
            "https://gh-proxy.com/https://github.com/x"
        );
        assert_eq!(
            with_mirror(Some("https://gh-proxy.com"), "https://github.com/x"),
            "https://gh-proxy.com/https://github.com/x"
        );
        assert_eq!(
            with_mirror(Some("  "), "https://github.com/x"),
            "https://github.com/x"
        );
    }

    #[test]
    fn checksum_lookup() {
        let sums = "aaa  other.tar.gz\n".to_string()
            + &"b".repeat(64)
            + "  frp_0.65.0_darwin_arm64.tar.gz\n";
        assert_eq!(
            parse_checksum(&sums, "frp_0.65.0_darwin_arm64.tar.gz"),
            Some("b".repeat(64))
        );
        assert_eq!(parse_checksum(&sums, "missing"), None);
    }

    #[test]
    fn only_official_urls() {
        assert!(check_release_url(
            "https://github.com/fatedier/frp/releases/download/v0.65.0/a.tar.gz"
        )
        .is_ok());
        assert!(check_release_url("https://evil.example/frp.tar.gz").is_err());
    }

    #[test]
    fn version_validation() {
        assert!(valid_version("0.65.0"));
        assert!(!valid_version("../x"));
        assert!(!valid_version(""));
    }

    #[test]
    fn extracts_frpc_from_tar_gz() {
        let mut tar_buf = Vec::new();
        {
            let gz = flate2::write::GzEncoder::new(&mut tar_buf, flate2::Compression::fast());
            let mut b = tar::Builder::new(gz);
            for (name, data) in [
                ("frp_0.1_x/frps", &b"server"[..]),
                ("frp_0.1_x/frpc", &b"client"[..]),
            ] {
                let mut h = tar::Header::new_gnu();
                h.set_size(data.len() as u64);
                h.set_mode(0o755);
                h.set_cksum();
                b.append_data(&mut h, name, data).unwrap();
            }
            b.into_inner().unwrap().finish().unwrap();
        }
        assert_eq!(extract_frpc(&tar_buf, "frp.tar.gz").unwrap(), b"client");
    }
}
