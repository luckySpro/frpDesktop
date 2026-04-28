//! TOML-based frpc configuration model and conversion.
//!
//! Editing strategy:
//! - The source-of-truth persisted on disk is the raw TOML text.
//! - For the form view, we parse TOML into a typed `FrpcForm` and serialize back.
//! - To preserve comments / field order when the user edits only form fields,
//!   we apply edits via `toml_edit::DocumentMut` over the previous document.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use toml_edit::{value, Array, DocumentMut, Item, Table};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuthConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginForm {
    /// e.g. "https2http", "http2https", "static_file" ...
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_addr: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crt_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_header_rewrite: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub request_headers_set: BTreeMap<String, String>,
    /// Additional free-form fields for forward compatibility.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyForm {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_domains: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_ip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subdomain: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin: Option<PluginForm>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FrpcForm {
    pub server_addr: String,
    pub server_port: u16,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default)]
    pub proxies: Vec<ProxyForm>,
}

/// Parse an existing TOML text into a typed form.
pub fn parse_to_form(toml_text: &str) -> AppResult<FrpcForm> {
    let raw: toml::Value = toml::from_str(toml_text)?;
    let server_addr = raw
        .get("serverAddr")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let server_port = raw
        .get("serverPort")
        .and_then(|v| v.as_integer())
        .unwrap_or(7000) as u16;

    let mut auth = AuthConfig::default();
    if let Some(t) = raw.get("auth").and_then(|v| v.as_table()) {
        auth.token = t.get("token").and_then(|v| v.as_str()).map(String::from);
    }

    let mut proxies: Vec<ProxyForm> = Vec::new();
    if let Some(arr) = raw.get("proxies").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(tbl) = item.as_table() {
                proxies.push(proxy_from_table(tbl));
            }
        }
    }

    Ok(FrpcForm {
        server_addr,
        server_port,
        auth,
        proxies,
    })
}

fn proxy_from_table(tbl: &toml::value::Table) -> ProxyForm {
    let get_str = |k: &str| tbl.get(k).and_then(|v| v.as_str()).map(String::from);
    let get_u16 = |k: &str| tbl.get(k).and_then(|v| v.as_integer()).map(|n| n as u16);
    let custom_domains = tbl
        .get("customDomains")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let plugin = tbl.get("plugin").and_then(|v| v.as_table()).map(|p| {
        let mut request_headers_set: BTreeMap<String, String> = BTreeMap::new();
        if let Some(rh) = p.get("requestHeaders").and_then(|v| v.as_table()) {
            if let Some(set) = rh.get("set").and_then(|v| v.as_table()) {
                for (k, v) in set.iter() {
                    if let Some(s) = v.as_str() {
                        request_headers_set.insert(k.clone(), s.to_string());
                    }
                }
            }
        }
        let known = [
            "type",
            "localAddr",
            "crtPath",
            "keyPath",
            "hostHeaderRewrite",
            "requestHeaders",
        ];
        let mut extra: BTreeMap<String, String> = BTreeMap::new();
        for (k, v) in p.iter() {
            if known.contains(&k.as_str()) {
                continue;
            }
            if let Some(s) = v.as_str() {
                extra.insert(k.clone(), s.to_string());
            }
        }
        PluginForm {
            kind: p.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            local_addr: p.get("localAddr").and_then(|v| v.as_str()).map(String::from),
            crt_path: p.get("crtPath").and_then(|v| v.as_str()).map(String::from),
            key_path: p.get("keyPath").and_then(|v| v.as_str()).map(String::from),
            host_header_rewrite: p
                .get("hostHeaderRewrite")
                .and_then(|v| v.as_str())
                .map(String::from),
            request_headers_set,
            extra,
        }
    });

    ProxyForm {
        name: get_str("name").unwrap_or_default(),
        kind: get_str("type").unwrap_or_else(|| "tcp".into()),
        custom_domains,
        local_ip: get_str("localIP").or_else(|| get_str("localIp")),
        local_port: get_u16("localPort"),
        remote_port: get_u16("remotePort"),
        subdomain: get_str("subdomain"),
        plugin,
    }
}

/// Render the whole form into a fresh TOML document.
pub fn form_to_toml(form: &FrpcForm) -> AppResult<String> {
    let mut doc = DocumentMut::new();
    doc["serverAddr"] = value(form.server_addr.clone());
    doc["serverPort"] = value(form.server_port as i64);
    if let Some(tk) = form.auth.token.clone() {
        let mut t = Table::new();
        t.set_implicit(false);
        t["token"] = value(tk);
        doc["auth"] = Item::Table(t);
    }
    let mut arr = toml_edit::ArrayOfTables::new();
    for p in &form.proxies {
        arr.push(proxy_to_table(p));
    }
    doc["proxies"] = Item::ArrayOfTables(arr);
    Ok(doc.to_string())
}

fn proxy_to_table(p: &ProxyForm) -> Table {
    let mut t = Table::new();
    t["name"] = value(p.name.clone());
    t["type"] = value(p.kind.clone());
    if !p.custom_domains.is_empty() {
        let mut a = Array::new();
        for d in &p.custom_domains {
            a.push(d.clone());
        }
        t["customDomains"] = value(a);
    }
    if let Some(ip) = &p.local_ip {
        t["localIP"] = value(ip.clone());
    }
    if let Some(port) = p.local_port {
        t["localPort"] = value(port as i64);
    }
    if let Some(port) = p.remote_port {
        t["remotePort"] = value(port as i64);
    }
    if let Some(sd) = &p.subdomain {
        t["subdomain"] = value(sd.clone());
    }
    if let Some(pl) = &p.plugin {
        let mut pt = Table::new();
        pt.set_implicit(false);
        pt["type"] = value(pl.kind.clone());
        if let Some(v) = &pl.local_addr {
            pt["localAddr"] = value(v.clone());
        }
        if let Some(v) = &pl.crt_path {
            pt["crtPath"] = value(v.clone());
        }
        if let Some(v) = &pl.key_path {
            pt["keyPath"] = value(v.clone());
        }
        if let Some(v) = &pl.host_header_rewrite {
            pt["hostHeaderRewrite"] = value(v.clone());
        }
        if !pl.request_headers_set.is_empty() {
            let mut rh = Table::new();
            rh.set_implicit(false);
            let mut set = Table::new();
            set.set_implicit(false);
            for (k, v) in pl.request_headers_set.iter() {
                set[k.as_str()] = value(v.clone());
            }
            rh["set"] = Item::Table(set);
            pt["requestHeaders"] = Item::Table(rh);
        }
        for (k, v) in pl.extra.iter() {
            pt[k.as_str()] = value(v.clone());
        }
        t["plugin"] = Item::Table(pt);
    }
    t
}

/// Validate syntax + required fields.
pub fn validate(toml_text: &str) -> AppResult<()> {
    let form = parse_to_form(toml_text)?;
    if form.server_addr.is_empty() {
        return Err(AppError::msg("serverAddr 不能为空"));
    }
    if form.server_port == 0 {
        return Err(AppError::msg("serverPort 无效"));
    }
    let mut seen = std::collections::HashSet::new();
    for p in &form.proxies {
        if p.name.is_empty() {
            return Err(AppError::msg("proxy name 不能为空"));
        }
        if !seen.insert(p.name.clone()) {
            return Err(AppError::msg(format!("proxy 名称重复: {}", p.name)));
        }
    }
    Ok(())
}
