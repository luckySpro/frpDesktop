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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginForm {
    /// none | https2http | https2https | http2https | static_file | http_proxy | socks5 | unix_domain_socket
    #[serde(rename = "type")]
    pub kind: String,
    // 反向代理类
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_addr: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_header_rewrite: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crt_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub request_headers_set: BTreeMap<String, String>,
    // unix_domain_socket
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unix_path: Option<String>,
    // static_file
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strip_prefix: Option<String>,
    // http_proxy / static_file 鉴权
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_password: Option<String>,
    // socks5 鉴权
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// Additional free-form fields for forward compatibility.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProxyForm {
    pub name: String,
    /// tcp | udp | http | https | tcpmux | stcp | sudp | xtcp
    #[serde(rename = "type")]
    pub kind: String,
    // 通用
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_ip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_port: Option<u16>,
    // http / https / tcpmux
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_domains: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subdomain: Option<String>,
    // http
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub locations: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_header_rewrite: Option<String>,
    // tcpmux
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub multiplexer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route_by_http_user: Option<String>,
    // stcp / sudp / xtcp
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_key: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allow_users: Vec<String>,
    // transport
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_encryption: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_compression: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bandwidth_limit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bandwidth_limit_mode: Option<String>,
    // 插件
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
    let get_str_arr = |k: &str| -> Vec<String> {
        tbl.get(k)
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    };

    // transport.* 嵌套表
    let (use_encryption, use_compression, bandwidth_limit, bandwidth_limit_mode) =
        if let Some(tr) = tbl.get("transport").and_then(|v| v.as_table()) {
            (
                tr.get("useEncryption").and_then(|v| v.as_bool()),
                tr.get("useCompression").and_then(|v| v.as_bool()),
                tr.get("bandwidthLimit").and_then(|v| v.as_str()).map(String::from),
                tr.get("bandwidthLimitMode").and_then(|v| v.as_str()).map(String::from),
            )
        } else {
            (None, None, None, None)
        };

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
            "unixPath",
            "localPath",
            "stripPrefix",
            "httpUser",
            "httpPassword",
            "username",
            "password",
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
        let pget = |k: &str| p.get(k).and_then(|v| v.as_str()).map(String::from);
        PluginForm {
            kind: p.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            local_addr: pget("localAddr"),
            host_header_rewrite: pget("hostHeaderRewrite"),
            crt_path: pget("crtPath"),
            key_path: pget("keyPath"),
            request_headers_set,
            unix_path: pget("unixPath"),
            local_path: pget("localPath"),
            strip_prefix: pget("stripPrefix"),
            http_user: pget("httpUser"),
            http_password: pget("httpPassword"),
            username: pget("username"),
            password: pget("password"),
            extra,
        }
    });

    ProxyForm {
        name: get_str("name").unwrap_or_default(),
        kind: get_str("type").unwrap_or_else(|| "tcp".into()),
        local_ip: get_str("localIP").or_else(|| get_str("localIp")),
        local_port: get_u16("localPort"),
        remote_port: get_u16("remotePort"),
        custom_domains: get_str_arr("customDomains"),
        subdomain: get_str("subdomain"),
        locations: get_str_arr("locations"),
        http_user: get_str("httpUser"),
        http_password: get_str("httpPassword"),
        host_header_rewrite: get_str("hostHeaderRewrite"),
        multiplexer: get_str("multiplexer"),
        route_by_http_user: get_str("routeByHTTPUser").or_else(|| get_str("routeByHttpUser")),
        secret_key: get_str("secretKey"),
        allow_users: get_str_arr("allowUsers"),
        use_encryption,
        use_compression,
        bandwidth_limit,
        bandwidth_limit_mode,
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
    if let Some(ip) = &p.local_ip {
        t["localIP"] = value(ip.clone());
    }
    if let Some(port) = p.local_port {
        t["localPort"] = value(port as i64);
    }
    if let Some(port) = p.remote_port {
        t["remotePort"] = value(port as i64);
    }
    if !p.custom_domains.is_empty() {
        let mut a = Array::new();
        for d in &p.custom_domains {
            a.push(d.clone());
        }
        t["customDomains"] = value(a);
    }
    if let Some(sd) = &p.subdomain {
        t["subdomain"] = value(sd.clone());
    }
    if !p.locations.is_empty() {
        let mut a = Array::new();
        for d in &p.locations {
            a.push(d.clone());
        }
        t["locations"] = value(a);
    }
    if let Some(v) = &p.http_user {
        t["httpUser"] = value(v.clone());
    }
    if let Some(v) = &p.http_password {
        t["httpPassword"] = value(v.clone());
    }
    if let Some(v) = &p.host_header_rewrite {
        t["hostHeaderRewrite"] = value(v.clone());
    }
    if let Some(v) = &p.multiplexer {
        t["multiplexer"] = value(v.clone());
    }
    if let Some(v) = &p.route_by_http_user {
        t["routeByHTTPUser"] = value(v.clone());
    }
    if let Some(v) = &p.secret_key {
        t["secretKey"] = value(v.clone());
    }
    if !p.allow_users.is_empty() {
        let mut a = Array::new();
        for d in &p.allow_users {
            a.push(d.clone());
        }
        t["allowUsers"] = value(a);
    }

    // transport.* 嵌套表
    let need_transport = p.use_encryption.is_some()
        || p.use_compression.is_some()
        || p.bandwidth_limit.is_some()
        || p.bandwidth_limit_mode.is_some();
    if need_transport {
        let mut tr = Table::new();
        tr.set_implicit(false);
        if let Some(b) = p.use_encryption {
            tr["useEncryption"] = value(b);
        }
        if let Some(b) = p.use_compression {
            tr["useCompression"] = value(b);
        }
        if let Some(v) = &p.bandwidth_limit {
            tr["bandwidthLimit"] = value(v.clone());
        }
        if let Some(v) = &p.bandwidth_limit_mode {
            tr["bandwidthLimitMode"] = value(v.clone());
        }
        t["transport"] = Item::Table(tr);
    }

    if let Some(pl) = &p.plugin {
        let mut pt = Table::new();
        pt.set_implicit(false);
        pt["type"] = value(pl.kind.clone());
        if let Some(v) = &pl.local_addr {
            pt["localAddr"] = value(v.clone());
        }
        if let Some(v) = &pl.host_header_rewrite {
            pt["hostHeaderRewrite"] = value(v.clone());
        }
        if let Some(v) = &pl.crt_path {
            pt["crtPath"] = value(v.clone());
        }
        if let Some(v) = &pl.key_path {
            pt["keyPath"] = value(v.clone());
        }
        if let Some(v) = &pl.unix_path {
            pt["unixPath"] = value(v.clone());
        }
        if let Some(v) = &pl.local_path {
            pt["localPath"] = value(v.clone());
        }
        if let Some(v) = &pl.strip_prefix {
            pt["stripPrefix"] = value(v.clone());
        }
        if let Some(v) = &pl.http_user {
            pt["httpUser"] = value(v.clone());
        }
        if let Some(v) = &pl.http_password {
            pt["httpPassword"] = value(v.clone());
        }
        if let Some(v) = &pl.username {
            pt["username"] = value(v.clone());
        }
        if let Some(v) = &pl.password {
            pt["password"] = value(v.clone());
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证全 8 种代理类型与部分插件可被解析并 round-trip 后保留关键字段。
    #[test]
    fn round_trip_all_proxy_types() {
        let src = r#"
serverAddr = "f.example.com"
serverPort = 7000
[auth]
token = "abc"

[[proxies]]
name = "https-vh"
type = "https"
customDomains = ["a.example.com"]
[proxies.plugin]
type = "https2http"
localAddr = "127.0.0.1:8080"
crtPath = "./certs/a.crt"
keyPath = "./certs/a.key"
hostHeaderRewrite = "127.0.0.1"
requestHeaders.set.x-from-where = "frp"

[[proxies]]
name = "ssh"
type = "tcp"
localIP = "127.0.0.1"
localPort = 22
remotePort = 6000
transport.useEncryption = true
transport.useCompression = true
transport.bandwidthLimit = "1MB"
transport.bandwidthLimitMode = "client"

[[proxies]]
name = "udp-dns"
type = "udp"
localIP = "127.0.0.1"
localPort = 53
remotePort = 6053

[[proxies]]
name = "http-vh"
type = "http"
customDomains = ["web.example.com"]
locations = ["/", "/api"]
httpUser = "u"
httpPassword = "p"
hostHeaderRewrite = "127.0.0.1"
localIP = "127.0.0.1"
localPort = 8080

[[proxies]]
name = "muxed"
type = "tcpmux"
multiplexer = "httpconnect"
customDomains = ["m.example.com"]
routeByHTTPUser = "alice"
localIP = "127.0.0.1"
localPort = 8000

[[proxies]]
name = "secret-ssh"
type = "stcp"
secretKey = "key1"
allowUsers = ["u1", "u2"]
localIP = "127.0.0.1"
localPort = 22

[[proxies]]
name = "secret-udp"
type = "sudp"
secretKey = "key2"
localIP = "127.0.0.1"
localPort = 53

[[proxies]]
name = "p2p"
type = "xtcp"
secretKey = "key3"
localIP = "127.0.0.1"
localPort = 22

[[proxies]]
name = "static"
type = "tcp"
remotePort = 6080
[proxies.plugin]
type = "static_file"
localPath = "/var/www"
stripPrefix = "static"
httpUser = "a"
httpPassword = "b"

[[proxies]]
name = "socks"
type = "tcp"
remotePort = 6081
[proxies.plugin]
type = "socks5"
username = "sk"
password = "pw"

[[proxies]]
name = "unix"
type = "tcp"
remotePort = 6082
[proxies.plugin]
type = "unix_domain_socket"
unixPath = "/var/run/docker.sock"
"#;

        let form = parse_to_form(src).expect("解析失败");
        assert_eq!(form.server_addr, "f.example.com");
        assert_eq!(form.server_port, 7000);
        assert_eq!(form.proxies.len(), 11);

        // 调查各个关键字段被正确读取
        let by_name = |n: &str| form.proxies.iter().find(|p| p.name == n).unwrap();

        let tcp = by_name("ssh");
        assert_eq!(tcp.kind, "tcp");
        assert_eq!(tcp.local_port, Some(22));
        assert_eq!(tcp.remote_port, Some(6000));
        assert_eq!(tcp.use_encryption, Some(true));
        assert_eq!(tcp.use_compression, Some(true));
        assert_eq!(tcp.bandwidth_limit.as_deref(), Some("1MB"));

        let http = by_name("http-vh");
        assert_eq!(http.locations, vec!["/".to_string(), "/api".to_string()]);
        assert_eq!(http.http_user.as_deref(), Some("u"));
        assert_eq!(http.host_header_rewrite.as_deref(), Some("127.0.0.1"));

        let mux = by_name("muxed");
        assert_eq!(mux.multiplexer.as_deref(), Some("httpconnect"));
        assert_eq!(mux.route_by_http_user.as_deref(), Some("alice"));

        let stcp = by_name("secret-ssh");
        assert_eq!(stcp.secret_key.as_deref(), Some("key1"));
        assert_eq!(stcp.allow_users, vec!["u1".to_string(), "u2".to_string()]);

        let sf = by_name("static").plugin.as_ref().unwrap();
        assert_eq!(sf.kind, "static_file");
        assert_eq!(sf.local_path.as_deref(), Some("/var/www"));
        assert_eq!(sf.strip_prefix.as_deref(), Some("static"));
        assert_eq!(sf.http_user.as_deref(), Some("a"));

        let sock = by_name("socks").plugin.as_ref().unwrap();
        assert_eq!(sock.kind, "socks5");
        assert_eq!(sock.username.as_deref(), Some("sk"));

        let uds = by_name("unix").plugin.as_ref().unwrap();
        assert_eq!(uds.unix_path.as_deref(), Some("/var/run/docker.sock"));

        // round-trip、重新解析后字段不变
        let toml2 = form_to_toml(&form).expect("序列化失败");
        let form2 = parse_to_form(&toml2).expect("二次解析失败");
        assert_eq!(form2.proxies.len(), form.proxies.len());
        for (a, b) in form.proxies.iter().zip(form2.proxies.iter()) {
            assert_eq!(a.name, b.name);
            assert_eq!(a.kind, b.kind);
            assert_eq!(a.local_port, b.local_port);
            assert_eq!(a.remote_port, b.remote_port);
            assert_eq!(a.custom_domains, b.custom_domains);
            assert_eq!(a.locations, b.locations);
            assert_eq!(a.secret_key, b.secret_key);
            assert_eq!(a.allow_users, b.allow_users);
            assert_eq!(a.multiplexer, b.multiplexer);
            assert_eq!(a.use_encryption, b.use_encryption);
            assert_eq!(a.bandwidth_limit, b.bandwidth_limit);
            assert_eq!(a.plugin.as_ref().map(|p| p.kind.clone()), b.plugin.as_ref().map(|p| p.kind.clone()));
        }
    }

    /// 验证现有项目根目录 frpc.toml 仍可被解析。
    #[test]
    fn legacy_https_unchanged() {
        let src = r#"
serverAddr = "f.ueware.com"
serverPort = 9780
auth.token = "luckyAa!1"

[[proxies]]
name = "funasr.ueware.com"
type = "https"
customDomains = ["funasr.ueware.com"]
[proxies.plugin]
type = "https2http"
localAddr = "127.0.0.1:5273"
crtPath = "./ueware.crt"
keyPath = "./ueware.key"
hostHeaderRewrite = "127.0.0.1"
requestHeaders.set.x-from-where = "frp"
"#;
        let form = parse_to_form(src).expect("解析失败");
        assert_eq!(form.proxies.len(), 1);
        let p = &form.proxies[0];
        assert_eq!(p.kind, "https");
        assert_eq!(p.custom_domains, vec!["funasr.ueware.com".to_string()]);
        let pl = p.plugin.as_ref().unwrap();
        assert_eq!(pl.kind, "https2http");
        assert_eq!(pl.local_addr.as_deref(), Some("127.0.0.1:5273"));
        assert_eq!(pl.crt_path.as_deref(), Some("./ueware.crt"));
        assert_eq!(
            pl.request_headers_set.get("x-from-where").map(String::as_str),
            Some("frp")
        );
    }
}
