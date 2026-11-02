//! frpc TOML configuration model, lossless save and validation.
//!
//! Editing strategy:
//! - The source of truth on disk is the raw TOML text.
//! - The form view works on a typed `FrpcForm` that only covers the fields the
//!   UI knows about.
//! - Saving the form never regenerates the file from scratch. `apply_form`
//!   edits the previous `toml_edit` document in place, so comments, key order,
//!   dotted-key style and every field the form does not model (log, transport,
//!   webServer, healthCheck, metadatas …) survive a round trip.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use toml_edit::{Array, ArrayOfTables, DocumentMut, Item, Table, Value};

use crate::error::{AppError, AppResult};

pub const PROXY_TYPES: [&str; 8] = [
    "tcp", "udp", "http", "https", "tcpmux", "stcp", "sudp", "xtcp",
];
pub const PLUGIN_TYPES: [&str; 8] = [
    "https2http",
    "https2https",
    "http2https",
    "http_proxy",
    "socks5",
    "static_file",
    "unix_domain_socket",
    "tls2raw",
];

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginForm {
    /// https2http | https2https | http2https | static_file | http_proxy | socks5 | unix_domain_socket | tls2raw
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_addr: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_header_rewrite: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crt_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(default)]
    pub request_headers_set: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unix_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strip_prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyForm {
    /// Index of this proxy in the document it was parsed from. New proxies have
    /// `None`. Used by `apply_form` to keep untouched fields and comments.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<usize>,
    /// `enabled = false` in TOML. Disabled proxies stay in the profile but
    /// are left out of the config frpc actually runs (see `runtime_text`).
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub name: String,
    /// tcp | udp | http | https | tcpmux | stcp | sudp | xtcp
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_ip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_port: Option<u16>,
    #[serde(default)]
    pub custom_domains: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subdomain: Option<String>,
    #[serde(default)]
    pub locations: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_header_rewrite: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub multiplexer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route_by_http_user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_key: Option<String>,
    #[serde(default)]
    pub allow_users: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_encryption: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_compression: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bandwidth_limit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bandwidth_limit_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin: Option<PluginForm>,
}

impl Default for ProxyForm {
    fn default() -> Self {
        ProxyForm {
            origin: None,
            enabled: true,
            name: String::new(),
            kind: String::new(),
            local_ip: None,
            local_port: None,
            remote_port: None,
            custom_domains: Vec::new(),
            subdomain: None,
            locations: Vec::new(),
            http_user: None,
            http_password: None,
            host_header_rewrite: None,
            multiplexer: None,
            route_by_http_user: None,
            secret_key: None,
            allow_users: Vec::new(),
            use_encryption: None,
            use_compression: None,
            bandwidth_limit: None,
            bandwidth_limit_mode: None,
            plugin: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrpcForm {
    pub server_addr: String,
    pub server_port: u16,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default)]
    pub proxies: Vec<ProxyForm>,
}

/// Template used when no profile exists yet.
pub const DEFAULT_TEMPLATE: &str = r#"# frpc 配置，由 frpDesktop 管理
serverAddr = ""
serverPort = 7000

[auth]
token = ""
"#;

// ---------------------------------------------------------------- parse

fn port_from(v: Option<&toml::Value>) -> Option<u16> {
    v.and_then(|v| v.as_integer())
        .and_then(|n| u16::try_from(n).ok())
}

/// Parse an existing TOML text into a typed form.
pub fn parse_to_form(toml_text: &str) -> AppResult<FrpcForm> {
    let raw: toml::Value = toml::from_str(toml_text)?;
    let server_addr = raw
        .get("serverAddr")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let server_port = match raw.get("serverPort") {
        None => 7000,
        Some(v) => {
            port_from(Some(v)).ok_or_else(|| AppError::msg("serverPort 必须是 1-65535 的整数"))?
        }
    };

    let mut auth = AuthConfig::default();
    if let Some(t) = raw.get("auth").and_then(|v| v.as_table()) {
        auth.token = t.get("token").and_then(|v| v.as_str()).map(String::from);
    }
    let user = raw.get("user").and_then(|v| v.as_str()).map(String::from);

    let mut proxies = Vec::new();
    if let Some(arr) = raw.get("proxies").and_then(|v| v.as_array()) {
        for (i, item) in arr.iter().enumerate() {
            if let Some(tbl) = item.as_table() {
                let mut p = proxy_from_table(tbl);
                p.origin = Some(i);
                proxies.push(p);
            }
        }
    }

    Ok(FrpcForm {
        server_addr,
        server_port,
        auth,
        user,
        proxies,
    })
}

fn proxy_from_table(tbl: &toml::value::Table) -> ProxyForm {
    let get_str = |k: &str| tbl.get(k).and_then(|v| v.as_str()).map(String::from);
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

    let tr = tbl.get("transport").and_then(|v| v.as_table());
    let tr_get = |k: &str| tr.and_then(|t| t.get(k));

    let plugin = tbl.get("plugin").and_then(|v| v.as_table()).map(|p| {
        let mut request_headers_set = BTreeMap::new();
        if let Some(set) = p
            .get("requestHeaders")
            .and_then(|v| v.as_table())
            .and_then(|rh| rh.get("set"))
            .and_then(|v| v.as_table())
        {
            for (k, v) in set {
                if let Some(s) = v.as_str() {
                    request_headers_set.insert(k.clone(), s.to_string());
                }
            }
        }
        let pget = |k: &str| p.get(k).and_then(|v| v.as_str()).map(String::from);
        PluginForm {
            kind: pget("type").unwrap_or_default(),
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
        }
    });

    ProxyForm {
        origin: None,
        enabled: tbl.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
        name: get_str("name").unwrap_or_default(),
        kind: get_str("type").unwrap_or_else(|| "tcp".into()),
        local_ip: get_str("localIP").or_else(|| get_str("localIp")),
        local_port: port_from(tbl.get("localPort")),
        remote_port: port_from(tbl.get("remotePort")),
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
        use_encryption: tr_get("useEncryption").and_then(|v| v.as_bool()),
        use_compression: tr_get("useCompression").and_then(|v| v.as_bool()),
        bandwidth_limit: tr_get("bandwidthLimit")
            .and_then(|v| v.as_str())
            .map(String::from),
        bandwidth_limit_mode: tr_get("bandwidthLimitMode")
            .and_then(|v| v.as_str())
            .map(String::from),
        plugin,
    }
}

// ---------------------------------------------------------------- write

/// Set `key` to `v`, keeping the decor (inline comments / spacing) of an
/// existing value so `name = "x"   # 备注` keeps its comment.
fn set_value(t: &mut Table, key: &str, mut v: Value) {
    if let Some(Item::Value(old)) = t.get(key) {
        if old.to_string().trim() == v.to_string().trim() {
            return;
        }
        let decor = old.decor().clone();
        *v.decor_mut() = decor;
    }
    t.insert(key, Item::Value(v));
}

fn set_opt_str(t: &mut Table, key: &str, v: &Option<String>) {
    match v.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => set_value(t, key, Value::from(s)),
        None => {
            t.remove(key);
        }
    }
}

fn set_opt_int(t: &mut Table, key: &str, v: Option<u16>) {
    match v {
        Some(n) => set_value(t, key, Value::from(n as i64)),
        None => {
            t.remove(key);
        }
    }
}

fn set_opt_bool(t: &mut Table, key: &str, v: Option<bool>) {
    match v {
        Some(b) => set_value(t, key, Value::from(b)),
        None => {
            t.remove(key);
        }
    }
}

fn set_str_arr(t: &mut Table, key: &str, v: &[String]) {
    let items: Vec<&str> = v
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if items.is_empty() {
        t.remove(key);
        return;
    }
    let mut a = Array::new();
    for s in items {
        a.push(s);
    }
    set_value(t, key, Value::Array(a));
}

/// Get (or create) a sub-table, preserving whether the original was written
/// as dotted keys (`transport.useEncryption = true`) or a `[section]`.
fn sub_table<'a>(t: &'a mut Table, key: &str, dotted_default: bool) -> &'a mut Table {
    let needs_new = !matches!(t.get(key), Some(Item::Table(_)));
    if needs_new {
        // Inline tables are converted to regular tables so we can edit them.
        let mut nt = match t.remove(key) {
            Some(Item::Value(Value::InlineTable(it))) => it.into_table(),
            _ => Table::new(),
        };
        nt.set_dotted(dotted_default);
        nt.set_implicit(dotted_default);
        t.insert(key, Item::Table(nt));
    }
    match t.get_mut(key) {
        Some(Item::Table(st)) => st,
        _ => unreachable!("sub_table inserted a table above"),
    }
}

fn drop_if_empty(t: &mut Table, key: &str) {
    if let Some(Item::Table(st)) = t.get(key) {
        if st.is_empty() {
            t.remove(key);
        }
    }
}

fn apply_plugin(t: &mut Table, pl: &Option<PluginForm>) {
    let pl = match pl {
        Some(p) if !p.kind.trim().is_empty() && p.kind != "none" => p,
        _ => {
            t.remove("plugin");
            return;
        }
    };
    let pt = sub_table(t, "plugin", false);
    let type_changed = pt
        .get("type")
        .and_then(|i| i.as_str())
        .map(|old| old != pl.kind)
        .unwrap_or(false);
    if type_changed {
        // Fields of the old plugin type are meaningless for the new one.
        let keys: Vec<String> = pt.iter().map(|(k, _)| k.to_string()).collect();
        for k in keys {
            if k != "type" {
                pt.remove(&k);
            }
        }
    }
    set_value(pt, "type", Value::from(pl.kind.as_str()));
    set_opt_str(pt, "localAddr", &pl.local_addr);
    set_opt_str(pt, "hostHeaderRewrite", &pl.host_header_rewrite);
    set_opt_str(pt, "crtPath", &pl.crt_path);
    set_opt_str(pt, "keyPath", &pl.key_path);
    set_opt_str(pt, "unixPath", &pl.unix_path);
    set_opt_str(pt, "localPath", &pl.local_path);
    set_opt_str(pt, "stripPrefix", &pl.strip_prefix);
    set_opt_str(pt, "httpUser", &pl.http_user);
    set_opt_str(pt, "httpPassword", &pl.http_password);
    set_opt_str(pt, "username", &pl.username);
    set_opt_str(pt, "password", &pl.password);

    let headers: BTreeMap<&str, &str> = pl
        .request_headers_set
        .iter()
        .map(|(k, v)| (k.trim(), v.as_str()))
        .filter(|(k, _)| !k.is_empty())
        .collect();
    if headers.is_empty() {
        if let Some(Item::Table(rh)) = pt.get_mut("requestHeaders") {
            rh.remove("set");
        }
        drop_if_empty(pt, "requestHeaders");
    } else {
        let rh = sub_table(pt, "requestHeaders", true);
        let set = sub_table(rh, "set", true);
        let existing: Vec<String> = set.iter().map(|(k, _)| k.to_string()).collect();
        for k in existing {
            if !headers.contains_key(k.as_str()) {
                set.remove(&k);
            }
        }
        for (k, v) in headers {
            set_value(set, k, Value::from(v));
        }
    }
}

fn apply_proxy(t: &mut Table, p: &ProxyForm) {
    set_value(t, "name", Value::from(p.name.trim()));
    set_value(t, "type", Value::from(p.kind.as_str()));
    if p.enabled {
        t.remove("enabled");
    } else {
        set_value(t, "enabled", Value::from(false));
    }
    if t.contains_key("localIp") {
        t.remove("localIp");
    }
    set_opt_str(t, "localIP", &p.local_ip);
    set_opt_int(t, "localPort", p.local_port);
    set_opt_int(t, "remotePort", p.remote_port);
    set_str_arr(t, "customDomains", &p.custom_domains);
    set_opt_str(t, "subdomain", &p.subdomain);
    set_str_arr(t, "locations", &p.locations);
    set_opt_str(t, "httpUser", &p.http_user);
    set_opt_str(t, "httpPassword", &p.http_password);
    set_opt_str(t, "hostHeaderRewrite", &p.host_header_rewrite);
    set_opt_str(t, "multiplexer", &p.multiplexer);
    if t.contains_key("routeByHttpUser") {
        t.remove("routeByHttpUser");
    }
    set_opt_str(t, "routeByHTTPUser", &p.route_by_http_user);
    set_opt_str(t, "secretKey", &p.secret_key);
    set_str_arr(t, "allowUsers", &p.allow_users);

    {
        let tr = sub_table(t, "transport", true);
        set_opt_bool(tr, "useEncryption", p.use_encryption);
        set_opt_bool(tr, "useCompression", p.use_compression);
        set_opt_str(tr, "bandwidthLimit", &p.bandwidth_limit);
        set_opt_str(tr, "bandwidthLimitMode", &p.bandwidth_limit_mode);
    }
    drop_if_empty(t, "transport");

    apply_plugin(t, &p.plugin);
    // Keep the plugin section last so it reads like hand-written configs.
    if let Some(item) = t.remove("plugin") {
        t.insert("plugin", item);
    }
}

/// Apply the form onto the previous document text and return the new text.
pub fn apply_form(original: &str, form: &FrpcForm) -> AppResult<String> {
    let mut doc: DocumentMut = if original.trim().is_empty() {
        DocumentMut::new()
    } else {
        original.parse()?
    };

    {
        let root = doc.as_table_mut();
        set_value(root, "serverAddr", Value::from(form.server_addr.trim()));
        set_value(root, "serverPort", Value::from(form.server_port as i64));
        set_opt_str(root, "user", &form.user);
    }
    match form.auth.token.as_deref().filter(|s| !s.is_empty()) {
        Some(tk) => {
            let root = doc.as_table_mut();
            let auth = sub_table(root, "auth", false);
            set_value(auth, "token", Value::from(tk));
        }
        None => {
            if let Some(Item::Table(auth)) = doc.as_table_mut().get_mut("auth") {
                auth.remove("token");
            }
            drop_if_empty(doc.as_table_mut(), "auth");
        }
    }

    let old: Vec<Table> = match doc.as_table_mut().remove("proxies") {
        Some(Item::ArrayOfTables(a)) => a.into_iter().collect(),
        Some(Item::Value(Value::Array(a))) => a
            .into_iter()
            .filter_map(|v| match v {
                Value::InlineTable(it) => Some(it.into_table()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };

    let mut arr = ArrayOfTables::new();
    for p in &form.proxies {
        let mut t = p
            .origin
            .and_then(|i| old.get(i).cloned())
            .unwrap_or_default();
        apply_proxy(&mut t, p);
        arr.push(t);
    }
    if !arr.is_empty() {
        doc.as_table_mut()
            .insert("proxies", Item::ArrayOfTables(arr));
    }

    let mut text = doc.to_string();
    if !text.ends_with('\n') {
        text.push('\n');
    }
    Ok(text)
}

fn proxy_tables_mut(doc: &mut DocumentMut) -> Vec<&mut Table> {
    match doc.as_table_mut().get_mut("proxies") {
        Some(Item::ArrayOfTables(a)) => a.iter_mut().collect(),
        _ => Vec::new(),
    }
}

/// The config frpc is actually started with: proxies marked
/// `enabled = false` are removed, and the `enabled` key is stripped from the
/// rest so frpc versions older than v0.66 (which reject unknown keys) still
/// accept it. Everything else is kept byte-for-byte.
pub fn runtime_text(text: &str) -> AppResult<String> {
    let mut doc: DocumentMut = text.parse()?;
    // Inline-array style `proxies = [{...}]` is normalised to [[proxies]].
    if let Some(Item::Value(Value::Array(_))) = doc.as_table().get("proxies") {
        if let Some(Item::Value(Value::Array(a))) = doc.as_table_mut().remove("proxies") {
            let mut arr = ArrayOfTables::new();
            for v in a {
                if let Value::InlineTable(it) = v {
                    arr.push(it.into_table());
                }
            }
            doc.as_table_mut()
                .insert("proxies", Item::ArrayOfTables(arr));
        }
    }
    if let Some(Item::ArrayOfTables(arr)) = doc.as_table_mut().get_mut("proxies") {
        arr.retain(|t| t.get("enabled").and_then(|i| i.as_bool()) != Some(false));
        if arr.is_empty() {
            doc.as_table_mut().remove("proxies");
        }
    }
    for t in proxy_tables_mut(&mut doc) {
        t.remove("enabled");
    }
    let mut out = doc.to_string();
    if !out.ends_with('\n') {
        out.push('\n');
    }
    Ok(out)
}

/// Render the form into a fresh document (no previous text available).
#[cfg(test)]
pub fn form_to_toml(form: &FrpcForm) -> AppResult<String> {
    apply_form("", form)
}

// ---------------------------------------------------------------- validate

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// error | warning
    pub level: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub ok: bool,
    pub issues: Vec<Issue>,
}

impl ValidationReport {
    fn err(&mut self, proxy: Option<&str>, m: impl Into<String>) {
        self.issues.push(Issue {
            level: "error",
            proxy: proxy.map(String::from),
            message: m.into(),
        });
    }
    fn warn(&mut self, proxy: Option<&str>, m: impl Into<String>) {
        self.issues.push(Issue {
            level: "warning",
            proxy: proxy.map(String::from),
            message: m.into(),
        });
    }
    pub fn first_error(&self) -> Option<&Issue> {
        self.issues.iter().find(|i| i.level == "error")
    }
}

fn is_host_port(s: &str) -> bool {
    match s.rsplit_once(':') {
        Some((h, p)) => !h.is_empty() && p.parse::<u16>().map(|n| n > 0).unwrap_or(false),
        None => false,
    }
}

/// Static checks on the form. File-level certificate checks live in
/// `certs::check_form` because they need the frpc working directory.
pub fn validate_form(form: &FrpcForm) -> ValidationReport {
    let mut r = ValidationReport::default();
    if form.server_addr.trim().is_empty() {
        r.err(None, "服务器地址 (serverAddr) 不能为空");
    }
    if form.server_port == 0 {
        r.err(None, "服务器端口 (serverPort) 无效");
    }
    if form.auth.token.as_deref().unwrap_or("").is_empty() {
        r.warn(None, "未设置 auth.token，frps 开启鉴权时将无法连接");
    }

    let mut names = HashSet::new();
    let mut domains: BTreeMap<String, String> = BTreeMap::new();
    for p in &form.proxies {
        let name = p.name.trim();
        let pn = Some(name);
        if name.is_empty() {
            r.err(None, "存在未命名的代理");
            continue;
        }
        if !names.insert(name.to_string()) {
            r.err(pn, format!("代理名称重复: {name}"));
        }
        // A switched-off proxy is not run, so its fields can't break frpc.
        if !p.enabled {
            continue;
        }
        let kind = p.kind.as_str();
        if !PROXY_TYPES.contains(&kind) {
            r.err(pn, format!("未知代理类型: {kind}"));
            continue;
        }
        let plugin = p
            .plugin
            .as_ref()
            .filter(|pl| !pl.kind.is_empty() && pl.kind != "none");

        if matches!(kind, "http" | "https" | "tcpmux") {
            let has_sub = p
                .subdomain
                .as_deref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            if p.custom_domains.is_empty() && !has_sub {
                r.err(
                    pn,
                    "需要至少一个自定义域名 (customDomains) 或子域名 (subdomain)",
                );
            }
            for d in &p.custom_domains {
                let d = d.trim().to_ascii_lowercase();
                if d.contains("://") || d.contains('/') || d.contains(':') {
                    r.err(pn, format!("域名只填主机名，不要带协议、端口或路径: {d}"));
                }
                if let Some(other) = domains.insert(format!("{kind}:{d}"), name.to_string()) {
                    r.err(pn, format!("域名 {d} 已被代理 {other} 使用"));
                }
            }
        }
        if matches!(kind, "tcp" | "udp") && p.remote_port.is_none() && plugin.is_none() {
            r.warn(pn, "未设置远程端口 (remotePort)，将由 frps 随机分配");
        }
        if matches!(kind, "stcp" | "sudp" | "xtcp")
            && p.secret_key.as_deref().unwrap_or("").is_empty()
        {
            r.warn(pn, "未设置 secretKey，访问端需使用相同密钥");
        }
        if plugin.is_none() && p.local_port.is_none() {
            r.err(pn, "需要本地端口 (localPort) 或插件");
        }

        if let Some(pl) = plugin {
            if !PLUGIN_TYPES.contains(&pl.kind.as_str()) {
                r.warn(pn, format!("未知插件类型: {}", pl.kind));
            }
            if matches!(
                pl.kind.as_str(),
                "https2http" | "https2https" | "http2https"
            ) {
                if kind != "https" && pl.kind.starts_with("https2") {
                    r.warn(pn, format!("{} 插件通常配合 https 类型代理使用", pl.kind));
                }
                match pl.local_addr.as_deref().map(str::trim) {
                    None | Some("") => {
                        r.err(pn, "插件需要本地地址 (localAddr)，例如 127.0.0.1:8080")
                    }
                    Some(a) if !is_host_port(a) => {
                        r.err(pn, format!("本地地址格式应为 host:port，当前为 {a}"))
                    }
                    _ => {}
                }
            }
            if matches!(pl.kind.as_str(), "https2http" | "https2https") {
                let crt = pl.crt_path.as_deref().unwrap_or("").trim();
                let key = pl.key_path.as_deref().unwrap_or("").trim();
                match (crt.is_empty(), key.is_empty()) {
                    (true, true) => {
                        r.warn(pn, "未配置证书，frpc 会使用自签名证书，浏览器将提示不安全")
                    }
                    (false, true) | (true, false) => {
                        r.err(pn, "证书 (crtPath) 和私钥 (keyPath) 需要同时填写")
                    }
                    _ => {}
                }
            }
            if pl.kind == "static_file" && pl.local_path.as_deref().unwrap_or("").is_empty() {
                r.err(pn, "static_file 插件需要本地目录 (localPath)");
            }
            if pl.kind == "unix_domain_socket" && pl.unix_path.as_deref().unwrap_or("").is_empty() {
                r.err(pn, "unix_domain_socket 插件需要 unixPath");
            }
        }
    }
    if !form.proxies.is_empty() && form.proxies.iter().all(|p| !p.enabled) {
        r.warn(
            None,
            "所有代理都已关闭，frpc 只会连接服务器，不提供任何代理",
        );
    }
    r.ok = r.first_error().is_none();
    r
}

#[cfg(test)]
mod tests;
