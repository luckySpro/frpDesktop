use super::*;

/// Shape of the configs users actually run: https + https2http + own cert,
/// dotted keys and inline comments. Token is a placeholder.
const HTTPS_SAMPLE: &str = r#"serverAddr = "frp.example.com"
serverPort = 7000
auth.token = "placeholder-token"

# 客户端管理面板
webServer.addr = "127.0.0.1"
webServer.port = 7400
log.level = "info"

[[proxies]]
name = "a.example.com"                  # 名称,随意填
type = "https"
customDomains = ["a.example.com"] # 需要指向的域名
[proxies.plugin]
type = "https2http"
localAddr = "127.0.0.1:5273"                                         # 需要穿透的本地web服务
crtPath = "./example.crt" # 对应域名的 crt 证书
keyPath = "./example.key"        # 对应域名的 key 证书
hostHeaderRewrite = "127.0.0.1"
requestHeaders.set.x-from-where = "frp"

[[proxies]]
name = "b.example.com"
type = "https"
customDomains = ["b.example.com"]
[proxies.healthCheck]
type = "tcp"
intervalSeconds = 10
[proxies.plugin]
type = "https2http"
localAddr = "127.0.0.1:8080"
crtPath = "./example.crt"
keyPath = "./example.key"
hostHeaderRewrite = "127.0.0.1"
requestHeaders.set.x-from-where = "frp"
"#;

#[test]
fn parses_https2http_sample() {
    let form = parse_to_form(HTTPS_SAMPLE).unwrap();
    assert_eq!(form.server_addr, "frp.example.com");
    assert_eq!(form.auth.token.as_deref(), Some("placeholder-token"));
    assert_eq!(form.proxies.len(), 2);
    let p = &form.proxies[0];
    assert_eq!(p.origin, Some(0));
    assert_eq!(p.kind, "https");
    assert_eq!(p.custom_domains, vec!["a.example.com"]);
    let pl = p.plugin.as_ref().unwrap();
    assert_eq!(pl.kind, "https2http");
    assert_eq!(pl.local_addr.as_deref(), Some("127.0.0.1:5273"));
    assert_eq!(pl.crt_path.as_deref(), Some("./example.crt"));
    assert_eq!(pl.host_header_rewrite.as_deref(), Some("127.0.0.1"));
    assert_eq!(
        pl.request_headers_set
            .get("x-from-where")
            .map(String::as_str),
        Some("frp")
    );
}

#[test]
fn unchanged_form_is_byte_identical() {
    let form = parse_to_form(HTTPS_SAMPLE).unwrap();
    let out = apply_form(HTTPS_SAMPLE, &form).unwrap();
    assert_eq!(out, HTTPS_SAMPLE);
}

#[test]
fn edit_keeps_comments_and_unknown_fields() {
    let mut form = parse_to_form(HTTPS_SAMPLE).unwrap();
    form.proxies[0].plugin.as_mut().unwrap().local_addr = Some("127.0.0.1:9100".into());
    form.proxies[1]
        .plugin
        .as_mut()
        .unwrap()
        .request_headers_set
        .insert("x-real".into(), "1".into());
    let out = apply_form(HTTPS_SAMPLE, &form).unwrap();

    assert!(out.contains(r#"localAddr = "127.0.0.1:9100"                                         # 需要穿透的本地web服务"#), "{out}");
    assert!(out.contains("# 名称,随意填"));
    assert!(out.contains("webServer.port = 7400"));
    assert!(out.contains("log.level = \"info\""));
    assert!(out.contains("[proxies.healthCheck]"));
    assert!(out.contains("intervalSeconds = 10"));
    assert!(out.contains("requestHeaders.set.x-real = \"1\""), "{out}");

    let again = parse_to_form(&out).unwrap();
    assert_eq!(
        again.proxies[0]
            .plugin
            .as_ref()
            .unwrap()
            .local_addr
            .as_deref(),
        Some("127.0.0.1:9100")
    );
    assert_eq!(
        again.proxies[1]
            .plugin
            .as_ref()
            .unwrap()
            .request_headers_set
            .len(),
        2
    );
}

#[test]
fn reorder_delete_and_add_follow_origin() {
    let mut form = parse_to_form(HTTPS_SAMPLE).unwrap();
    // delete first, add a new one in front of the remaining (healthCheck) proxy
    form.proxies.remove(0);
    form.proxies.insert(
        0,
        ProxyForm {
            name: "ssh".into(),
            kind: "tcp".into(),
            local_ip: Some("127.0.0.1".into()),
            local_port: Some(22),
            remote_port: Some(6000),
            use_encryption: Some(true),
            ..Default::default()
        },
    );
    let out = apply_form(HTTPS_SAMPLE, &form).unwrap();
    let again = parse_to_form(&out).unwrap();
    assert_eq!(again.proxies.len(), 2);
    assert_eq!(again.proxies[0].name, "ssh");
    assert_eq!(again.proxies[0].use_encryption, Some(true));
    assert_eq!(again.proxies[1].name, "b.example.com");
    assert!(
        out.contains("intervalSeconds = 10"),
        "healthCheck must follow its proxy: {out}"
    );
    assert!(!out.contains("a.example.com"));
}

#[test]
fn plugin_type_change_drops_stale_fields_and_none_removes_plugin() {
    let mut form = parse_to_form(HTTPS_SAMPLE).unwrap();
    form.proxies[0].plugin = Some(PluginForm {
        kind: "static_file".into(),
        local_path: Some("/srv/www".into()),
        ..Default::default()
    });
    form.proxies[1].plugin = None;
    let out = apply_form(HTTPS_SAMPLE, &form).unwrap();
    let again = parse_to_form(&out).unwrap();
    let pl = again.proxies[0].plugin.as_ref().unwrap();
    assert_eq!(pl.kind, "static_file");
    assert!(pl.crt_path.is_none());
    assert!(pl.request_headers_set.is_empty());
    assert!(again.proxies[1].plugin.is_none());
}

#[test]
fn empty_token_removes_auth_table() {
    let mut form = parse_to_form(HTTPS_SAMPLE).unwrap();
    form.auth.token = None;
    let out = apply_form(HTTPS_SAMPLE, &form).unwrap();
    assert!(!out.contains("auth"));
}

#[test]
fn fresh_document_round_trips_all_types() {
    let src = r#"
serverAddr = "f.example.com"
serverPort = 7000
[auth]
token = "abc"

[[proxies]]
name = "ssh"
type = "tcp"
localIP = "127.0.0.1"
localPort = 22
remotePort = 6000
transport.useEncryption = true
transport.bandwidthLimit = "1MB"

[[proxies]]
name = "http-vh"
type = "http"
customDomains = ["web.example.com"]
locations = ["/", "/api"]
httpUser = "u"
httpPassword = "p"
localPort = 8080

[[proxies]]
name = "muxed"
type = "tcpmux"
multiplexer = "httpconnect"
customDomains = ["m.example.com"]
routeByHTTPUser = "alice"
localPort = 8000

[[proxies]]
name = "secret"
type = "stcp"
secretKey = "k"
allowUsers = ["u1", "u2"]
localPort = 22

[[proxies]]
name = "socks"
type = "tcp"
remotePort = 6081
[proxies.plugin]
type = "socks5"
username = "sk"
password = "pw"
"#;
    let form = parse_to_form(src).unwrap();
    let mut fresh = form.clone();
    for p in fresh.proxies.iter_mut() {
        p.origin = None;
    }
    let out = form_to_toml(&fresh).unwrap();
    let mut again = parse_to_form(&out).unwrap();
    for (i, p) in again.proxies.iter_mut().enumerate() {
        assert_eq!(p.origin, Some(i));
        p.origin = None;
    }
    assert_eq!(again, fresh);
}

#[test]
fn out_of_range_ports_are_not_truncated() {
    let src = "serverAddr = \"a\"\nserverPort = 70000\n";
    assert!(parse_to_form(src).is_err());
    let src = "serverAddr = \"a\"\n[[proxies]]\nname = \"x\"\ntype = \"tcp\"\nlocalPort = 65600\n";
    let form = parse_to_form(src).unwrap();
    assert_eq!(form.proxies[0].local_port, None);
}

#[test]
fn validation_catches_common_https_mistakes() {
    let mut form = parse_to_form(HTTPS_SAMPLE).unwrap();
    assert!(validate_form(&form).ok);

    form.proxies[1].custom_domains = vec!["https://a.example.com".into()];
    form.proxies[0].plugin.as_mut().unwrap().key_path = None;
    form.proxies[0].plugin.as_mut().unwrap().local_addr = Some("8080".into());
    let r = validate_form(&form);
    assert!(!r.ok);
    let msgs: Vec<&str> = r.issues.iter().map(|i| i.message.as_str()).collect();
    assert!(msgs.iter().any(|m| m.contains("不要带协议")), "{msgs:?}");
    assert!(msgs.iter().any(|m| m.contains("同时填写")), "{msgs:?}");
    assert!(msgs.iter().any(|m| m.contains("host:port")), "{msgs:?}");
}

#[test]
fn validation_flags_duplicate_domain_and_name() {
    let mut form = parse_to_form(HTTPS_SAMPLE).unwrap();
    form.proxies[1].custom_domains = vec!["a.example.com".into()];
    form.proxies[1].name = "a.example.com".into();
    let r = validate_form(&form);
    assert!(r.issues.iter().any(|i| i.message.contains("已被代理")));
    assert!(r.issues.iter().any(|i| i.message.contains("名称重复")));
}
