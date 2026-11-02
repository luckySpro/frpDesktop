//! Certificate library: inspect PEM certs / keys used by https2http and
//! https2https plugins, check expiry, domain coverage and key pairing.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::config::{FrpcForm, Issue};
use crate::error::{AppError, AppResult};
use crate::fsutil;

/// Certificates expiring within this many days are flagged.
pub const EXPIRY_WARN_DAYS: i64 = 15;
/// Refuse to read anything bigger than this as a cert / key.
const MAX_PEM_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CertInfo {
    pub subject_cn: Option<String>,
    pub issuer: String,
    pub dns_names: Vec<String>,
    pub not_before: i64,
    pub not_after: i64,
    pub days_left: i64,
    pub self_signed: bool,
    /// Number of certificates in the file (leaf + chain).
    pub chain_len: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertFile {
    pub file_name: String,
    /// Path as it should be written into frpc config (`./certs/<name>`).
    pub config_path: String,
    pub abs_path: String,
    /// cert | key | unknown
    pub kind: &'static str,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cert: Option<CertInfo>,
    /// For a cert: matching key in the library. For a key: matching cert.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pair: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn read_pem(path: &Path) -> AppResult<Vec<u8>> {
    let meta = std::fs::metadata(path)
        .map_err(|e| AppError::msg(format!("无法读取 {}: {e}", path.display())))?;
    if !meta.is_file() {
        return Err(AppError::msg(format!("{} 不是文件", path.display())));
    }
    if meta.len() > MAX_PEM_BYTES {
        return Err(AppError::msg(format!(
            "{} 过大，不像是证书文件",
            path.display()
        )));
    }
    Ok(std::fs::read(path)?)
}

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Parse the leaf certificate (first PEM block) of a cert file.
pub fn inspect_cert_bytes(bytes: &[u8]) -> AppResult<(CertInfo, Vec<u8>)> {
    use x509_parser::prelude::*;
    let mut blocks = Vec::new();
    for pem in Pem::iter_from_buffer(bytes) {
        let pem = pem.map_err(|e| AppError::msg(format!("PEM 解析失败: {e}")))?;
        if pem.label == "CERTIFICATE" {
            blocks.push(pem);
        }
    }
    let leaf = blocks
        .first()
        .ok_or_else(|| AppError::msg("文件中没有 CERTIFICATE 块（需要 PEM 格式的 .crt/.pem）"))?;
    let (_, cert) = X509Certificate::from_der(&leaf.contents)
        .map_err(|e| AppError::msg(format!("证书解析失败: {e}")))?;

    let subject_cn = cert
        .subject()
        .iter_common_name()
        .next()
        .and_then(|cn| cn.as_str().ok())
        .map(String::from);
    let issuer = cert
        .issuer()
        .iter_organization()
        .next()
        .and_then(|o| o.as_str().ok())
        .map(String::from)
        .or_else(|| {
            cert.issuer()
                .iter_common_name()
                .next()
                .and_then(|cn| cn.as_str().ok())
                .map(String::from)
        })
        .unwrap_or_else(|| cert.issuer().to_string());
    let mut dns_names = Vec::new();
    if let Ok(Some(san)) = cert.subject_alternative_name() {
        for n in &san.value.general_names {
            if let GeneralName::DNSName(d) = n {
                dns_names.push(d.to_ascii_lowercase());
            }
        }
    }
    if dns_names.is_empty() {
        if let Some(cn) = &subject_cn {
            dns_names.push(cn.to_ascii_lowercase());
        }
    }
    let not_before = cert.validity().not_before.timestamp();
    let not_after = cert.validity().not_after.timestamp();
    let info = CertInfo {
        subject_cn,
        issuer,
        dns_names,
        not_before,
        not_after,
        days_left: (not_after - now_ts()).div_euclid(86_400),
        self_signed: cert.subject() == cert.issuer(),
        chain_len: blocks.len(),
    };
    let spki = cert.public_key().raw.to_vec();
    Ok((info, spki))
}

/// DER SubjectPublicKeyInfo derived from a PEM private key.
pub fn key_public_spki(bytes: &[u8]) -> AppResult<Vec<u8>> {
    use rustls::pki_types::pem::PemObject;
    use rustls::pki_types::PrivateKeyDer;
    let key = PrivateKeyDer::from_pem_slice(bytes)
        .map_err(|_| AppError::msg("文件中没有可识别的私钥（需要 PEM 格式，且不能加密）"))?;
    let signing = rustls::crypto::ring::sign::any_supported_type(&key)
        .map_err(|e| AppError::msg(format!("不支持的私钥类型: {e}")))?;
    let spki = signing
        .public_key()
        .ok_or_else(|| AppError::msg("无法从私钥计算公钥"))?;
    Ok(spki.as_ref().to_vec())
}

/// `*.example.com` matches exactly one extra label.
pub fn name_matches(pattern: &str, host: &str) -> bool {
    let pattern = pattern.trim().trim_end_matches('.').to_ascii_lowercase();
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if let Some(suffix) = pattern.strip_prefix("*.") {
        match host.split_once('.') {
            Some((label, rest)) => !label.is_empty() && rest == suffix,
            None => false,
        }
    } else {
        pattern == host
    }
}

pub fn covers(info: &CertInfo, host: &str) -> bool {
    info.dns_names.iter().any(|p| name_matches(p, host))
}

fn classify(bytes: &[u8]) -> &'static str {
    let text = String::from_utf8_lossy(bytes);
    if text.contains("-----BEGIN CERTIFICATE-----") {
        "cert"
    } else if text.contains("PRIVATE KEY-----") {
        "key"
    } else {
        "unknown"
    }
}

/// List the certificate library directory.
pub fn list(certs_dir: &Path) -> AppResult<Vec<CertFile>> {
    let mut out = Vec::new();
    if !certs_dir.exists() {
        return Ok(out);
    }
    let mut spkis: Vec<(usize, Vec<u8>)> = Vec::new();
    let mut key_spkis: Vec<(usize, Vec<u8>)> = Vec::new();
    let mut entries: Vec<_> = std::fs::read_dir(certs_dir)?
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || !path.is_file() {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let mut f = CertFile {
            config_path: format!("./certs/{name}"),
            abs_path: path.to_string_lossy().to_string(),
            file_name: name,
            kind: "unknown",
            size,
            cert: None,
            pair: None,
            error: None,
        };
        match read_pem(&path) {
            Err(e) => f.error = Some(e.to_string()),
            Ok(bytes) => {
                f.kind = classify(&bytes);
                match f.kind {
                    "cert" => match inspect_cert_bytes(&bytes) {
                        Ok((info, spki)) => {
                            f.cert = Some(info);
                            spkis.push((out.len(), spki));
                        }
                        Err(e) => f.error = Some(e.to_string()),
                    },
                    "key" => match key_public_spki(&bytes) {
                        Ok(spki) => key_spkis.push((out.len(), spki)),
                        Err(e) => f.error = Some(e.to_string()),
                    },
                    _ => f.error = Some("不是 PEM 证书或私钥".into()),
                }
            }
        }
        out.push(f);
    }
    for (ci, cs) in &spkis {
        if let Some((ki, _)) = key_spkis.iter().find(|(_, ks)| ks == cs) {
            out[*ci].pair = Some(out[*ki].file_name.clone());
            out[*ki].pair = Some(out[*ci].file_name.clone());
        }
    }
    Ok(out)
}

/// Copy a cert / key file into the library after checking it parses.
/// Returns the config path (`./certs/<name>`).
pub fn import(certs_dir: &Path, src: &Path) -> AppResult<String> {
    let bytes = read_pem(src)?;
    match classify(&bytes) {
        "cert" => {
            inspect_cert_bytes(&bytes)?;
        }
        "key" => {
            key_public_spki(&bytes)?;
        }
        _ => {
            return Err(AppError::msg(format!(
                "{} 不是 PEM 证书或私钥",
                src.display()
            )))
        }
    }
    let name = src
        .file_name()
        .ok_or_else(|| AppError::msg("无法解析文件名"))?
        .to_string_lossy()
        .to_string();
    fsutil::safe_file_name(&name)?;
    let dest = certs_dir.join(&name);
    let same =
        src.canonicalize().ok().is_some() && src.canonicalize().ok() == dest.canonicalize().ok();
    if !same {
        fsutil::atomic_write(&dest, &bytes, true)?;
        restrict_permissions(&dest);
    }
    Ok(format!("./certs/{name}"))
}

/// Private keys should not be world readable.
fn restrict_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

pub fn delete(certs_dir: &Path, file_name: &str) -> AppResult<()> {
    let name = fsutil::safe_file_name(file_name)?;
    let path = certs_dir.join(name);
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    let _ = std::fs::remove_file(certs_dir.join(format!("{name}.bak")));
    Ok(())
}

/// File-level checks for every https2http / https2https proxy: files exist,
/// parse, cert covers the domains, cert and key belong together, expiry.
pub fn check_form(form: &FrpcForm, cwd: &Path) -> Vec<Issue> {
    let mut issues = Vec::new();
    let mut cache: BTreeMap<PathBuf, Result<(CertInfo, Vec<u8>), String>> = BTreeMap::new();
    let mut push = |level: &'static str, proxy: &str, message: String| {
        issues.push(Issue {
            level,
            proxy: Some(proxy.to_string()),
            message,
        })
    };

    for p in form.proxies.iter().filter(|p| p.enabled) {
        let Some(pl) = p.plugin.as_ref() else {
            continue;
        };
        if !matches!(pl.kind.as_str(), "https2http" | "https2https") {
            continue;
        }
        let crt = pl.crt_path.as_deref().unwrap_or("").trim();
        let key = pl.key_path.as_deref().unwrap_or("").trim();
        if crt.is_empty() || key.is_empty() {
            continue;
        }
        let crt_path = fsutil::resolve_relative(cwd, crt);
        let key_path = fsutil::resolve_relative(cwd, key);

        let cert = cache
            .entry(crt_path.clone())
            .or_insert_with(|| {
                read_pem(&crt_path)
                    .and_then(|b| inspect_cert_bytes(&b))
                    .map_err(|e| e.to_string())
            })
            .clone();
        let cert = match cert {
            Ok(c) => Some(c),
            Err(e) => {
                let msg = if crt_path.exists() {
                    format!("证书 {crt} 无法使用: {e}")
                } else {
                    format!(
                        "找不到证书文件 {crt}（实际路径 {}）。请在证书库导入后重新选择",
                        crt_path.display()
                    )
                };
                push("error", &p.name, msg);
                None
            }
        };
        let key_spki = match read_pem(&key_path).and_then(|b| key_public_spki(&b)) {
            Ok(s) => Some(s),
            Err(e) => {
                let msg = if key_path.exists() {
                    format!("私钥 {key} 无法使用: {e}")
                } else {
                    format!("找不到私钥文件 {key}（实际路径 {}）", key_path.display())
                };
                push("error", &p.name, msg);
                None
            }
        };
        let Some((info, cert_spki)) = cert else {
            continue;
        };
        if let Some(ks) = key_spki {
            if ks != cert_spki {
                push("error", &p.name, format!("证书 {crt} 与私钥 {key} 不匹配"));
            }
        }
        if info.days_left < 0 {
            push("error", &p.name, format!("证书 {crt} 已过期"));
        } else if info.days_left <= EXPIRY_WARN_DAYS {
            push(
                "warning",
                &p.name,
                format!("证书 {crt} 将在 {} 天后过期", info.days_left),
            );
        }
        for d in &p.custom_domains {
            if !covers(&info, d) {
                push(
                    "error",
                    &p.name,
                    format!(
                        "证书 {crt} 不包含域名 {d}（证书域名: {}）",
                        info.dns_names.join(", ")
                    ),
                );
            }
        }
        if info.self_signed {
            push(
                "warning",
                &p.name,
                format!("证书 {crt} 是自签名证书，浏览器会提示不安全"),
            );
        }
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wildcard_matching() {
        assert!(name_matches("*.example.com", "a.example.com"));
        assert!(!name_matches("*.example.com", "example.com"));
        assert!(!name_matches("*.example.com", "a.b.example.com"));
        assert!(name_matches("Example.com", "example.com."));
        assert!(!name_matches("example.com", "a.example.com"));
    }

    #[test]
    fn classify_pem() {
        assert_eq!(classify(b"-----BEGIN CERTIFICATE-----\n"), "cert");
        assert_eq!(classify(b"-----BEGIN RSA PRIVATE KEY-----\n"), "key");
        assert_eq!(classify(b"-----BEGIN EC PRIVATE KEY-----\n"), "key");
        assert_eq!(classify(b"hello"), "unknown");
    }

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("frpd-certs-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("certs")).unwrap();
        d
    }

    fn write_pair(dir: &Path, stem: &str, names: &[&str]) {
        let ck = rcgen::generate_simple_self_signed(
            names.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        )
        .unwrap();
        std::fs::write(dir.join(format!("certs/{stem}.crt")), ck.cert.pem()).unwrap();
        std::fs::write(
            dir.join(format!("certs/{stem}.key")),
            ck.key_pair.serialize_pem(),
        )
        .unwrap();
    }

    fn https_form(domain: &str, crt: &str, key: &str) -> FrpcForm {
        use crate::config::{PluginForm, ProxyForm};
        FrpcForm {
            server_addr: "frp.example.com".into(),
            server_port: 7000,
            proxies: vec![ProxyForm {
                name: domain.into(),
                kind: "https".into(),
                custom_domains: vec![domain.into()],
                plugin: Some(PluginForm {
                    kind: "https2http".into(),
                    local_addr: Some("127.0.0.1:8080".into()),
                    crt_path: Some(crt.into()),
                    key_path: Some(key.into()),
                    ..Default::default()
                }),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn library_pairs_cert_and_key() {
        let dir = tmpdir("list");
        write_pair(&dir, "wild", &["*.example.com"]);
        let files = list(&dir.join("certs")).unwrap();
        let crt = files.iter().find(|f| f.file_name == "wild.crt").unwrap();
        assert_eq!(crt.kind, "cert");
        assert_eq!(crt.pair.as_deref(), Some("wild.key"));
        assert_eq!(crt.cert.as_ref().unwrap().dns_names, vec!["*.example.com"]);
        assert!(crt.cert.as_ref().unwrap().days_left > 300);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn check_form_accepts_matching_wildcard_cert() {
        let dir = tmpdir("ok");
        write_pair(&dir, "wild", &["*.example.com"]);
        let form = https_form("a.example.com", "./certs/wild.crt", "./certs/wild.key");
        let issues = check_form(&form, &dir);
        assert!(issues.iter().all(|i| i.level != "error"), "{issues:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn check_form_reports_wrong_domain_key_mismatch_and_missing_file() {
        let dir = tmpdir("bad");
        write_pair(&dir, "one", &["one.example.com"]);
        write_pair(&dir, "two", &["two.example.com"]);
        let form = https_form("a.example.com", "./certs/one.crt", "./certs/two.key");
        let msgs: Vec<String> = check_form(&form, &dir)
            .into_iter()
            .map(|i| i.message)
            .collect();
        assert!(
            msgs.iter().any(|m| m.contains("不包含域名 a.example.com")),
            "{msgs:?}"
        );
        assert!(msgs.iter().any(|m| m.contains("不匹配")), "{msgs:?}");

        let form = https_form("a.example.com", "./ueware.crt", "./ueware.key");
        let msgs: Vec<String> = check_form(&form, &dir)
            .into_iter()
            .map(|i| i.message)
            .collect();
        assert!(
            msgs.iter()
                .any(|m| m.contains("找不到证书文件 ./ueware.crt")),
            "{msgs:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// RSA keys from openssl (PKCS#8 and traditional) pair with their cert.
    #[test]
    fn openssl_rsa_pair_matches() {
        let dir = tmpdir("rsa");
        let ok = std::process::Command::new("openssl")
            .args([
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "3",
                "-subj",
                "/CN=a.test.local",
            ])
            .arg("-keyout")
            .arg(dir.join("certs/a.key"))
            .arg("-out")
            .arg(dir.join("certs/a.crt"))
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !ok {
            eprintln!("openssl not available, skipping");
            return;
        }
        let files = list(&dir.join("certs")).unwrap();
        let crt = files.iter().find(|f| f.file_name == "a.crt").unwrap();
        assert_eq!(crt.pair.as_deref(), Some("a.key"), "{files:?}");
        let info = crt.cert.as_ref().unwrap();
        assert!(covers(info, "a.test.local"), "CN fallback when no SAN");
        assert!(info.days_left <= 3);
        let form = https_form("a.test.local", "./certs/a.crt", "./certs/a.key");
        let issues = check_form(&form, &dir);
        assert!(
            issues.iter().any(|i| i.message.contains("天后过期")),
            "{issues:?}"
        );
        assert!(issues.iter().all(|i| i.level != "error"), "{issues:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_rejects_non_pem_and_bad_names() {
        let dir = tmpdir("imp");
        let junk = dir.join("junk.crt");
        std::fs::write(&junk, b"not a cert").unwrap();
        assert!(import(&dir.join("certs"), &junk).is_err());
        assert!(delete(&dir.join("certs"), "../junk.crt").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
