import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  message,
  Popconfirm,
  Empty,
  Alert,
} from "antd";
import {
  SaveOutlined,
  ReloadOutlined,
  PlusOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  SafetyCertificateOutlined,
  KeyOutlined,
  ApiOutlined,
  GlobalOutlined,
  CloudServerOutlined,
  LockOutlined,
  FormOutlined,
  CodeOutlined,
  ThunderboltOutlined,
  UserOutlined,
  EditOutlined,
} from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, FrpcForm, PluginForm, ProxyForm } from "../api/tauri";

// frp 全部 8 种代理类型
const proxyTypes: { value: string; label: string; desc: string }[] = [
  { value: "tcp", label: "TCP", desc: "透传 TCP 端口" },
  { value: "udp", label: "UDP", desc: "透传 UDP 端口" },
  { value: "http", label: "HTTP", desc: "HTTP 虚拟主机 / 路径路由" },
  { value: "https", label: "HTTPS", desc: "HTTPS 虚拟主机 (可配合 https2http 插件)" },
  { value: "tcpmux", label: "TCPMUX", desc: "多路复用 TCP，按 host 分发" },
  { value: "stcp", label: "STCP", desc: "点对点加密 TCP (紧迫联接)" },
  { value: "sudp", label: "SUDP", desc: "点对点加密 UDP" },
  { value: "xtcp", label: "XTCP", desc: "P2P NAT 穿透的 TCP" },
];

// frp 全部 9 种插件类型
const pluginTypes: { value: string; label: string }[] = [
  { value: "none", label: "不使用插件" },
  { value: "https2http", label: "https2http (HTTPS 入 → HTTP 出)" },
  { value: "https2https", label: "https2https (HTTPS 入 → HTTPS 出)" },
  { value: "http2https", label: "http2https (HTTP 入 → HTTPS 出)" },
  { value: "http_proxy", label: "http_proxy (HTTP 代理)" },
  { value: "socks5", label: "socks5 (SOCKS5 代理)" },
  { value: "static_file", label: "static_file (静态文件服务)" },
  { value: "unix_domain_socket", label: "unix_domain_socket (Unix 域套接字)" },
];

// 判断某种代理需要哪些字段 (类型与字段映射表)
function featuresOf(type: string) {
  const t = (type || "tcp").toLowerCase();
  return {
    needLocal: ["tcp", "udp", "http", "https", "tcpmux", "stcp", "sudp", "xtcp"].includes(t),
    needRemotePort: ["tcp", "udp"].includes(t),
    needCustomDomains: ["http", "https", "tcpmux"].includes(t),
    needSubdomain: ["http", "https", "tcpmux"].includes(t),
    needLocations: t === "http",
    needHttpAuth: ["http", "tcpmux"].includes(t),
    needHostHeaderRewrite: t === "http",
    needMultiplexer: t === "tcpmux",
    needSecretKey: ["stcp", "sudp", "xtcp"].includes(t),
    needAllowUsers: ["stcp", "sudp", "xtcp"].includes(t),
    canPlugin: ["http", "https", "tcp"].includes(t),
  };
}

// 判断某种插件需要哪些字段
function pluginFeaturesOf(type: string) {
  const t = (type || "none").toLowerCase();
  return {
    needLocalAddr: ["https2http", "https2https", "http2https"].includes(t),
    needCert: ["https2http", "https2https"].includes(t),
    needHostHeaderRewrite: ["https2http", "https2https", "http2https"].includes(t),
    needRequestHeaders: ["https2http", "https2https", "http2https"].includes(t),
    needUnixPath: t === "unix_domain_socket",
    needStaticFile: t === "static_file",
    needHttpAuth: ["http_proxy", "static_file"].includes(t),
    needSocks5Auth: t === "socks5",
  };
}

function registerTomlLanguage(monaco: any) {
  if (monaco.languages.getLanguages().some((l: any) => l.id === "toml")) return;
  monaco.languages.register({ id: "toml", extensions: [".toml"] });
  monaco.languages.setMonarchTokensProvider("toml", {
    defaultToken: "",
    tokenPostfix: ".toml",
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
    tokenizer: {
      root: [
        [/\s*#.*$/, "comment"],
        [/^\s*\[\[[^\]]+\]\]/, "type.identifier"],
        [/^\s*\[[^\]]+\]/, "type.identifier"],
        [/[A-Za-z_][\w-]*(?=\s*[.=])/, "key"],
        [/\./, "delimiter"],
        [/=/, "operator"],
        [/\b(true|false)\b/, "keyword"],
        [/\b\d{4}-\d{2}-\d{2}(?:[Tt][0-9:.+\-Zz]+)?\b/, "number"],
        [/[+-]?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, "number"],
        [/"""/, { token: "string.quote", next: "@mstring" }],
        [/'''/, { token: "string.quote", next: "@mlit" }],
        [/"/, { token: "string.quote", next: "@string" }],
        [/'/, { token: "string.quote", next: "@lit" }],
        [/[\[\]{}(),]/, "delimiter"],
      ],
      string: [
        [/[^\\"]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/"/, { token: "string.quote", next: "@pop" }],
      ],
      mstring: [
        [/[^"]+/, "string"],
        [/"""/, { token: "string.quote", next: "@pop" }],
        [/"/, "string"],
      ],
      lit: [
        [/[^']+/, "string"],
        [/'/, { token: "string.quote", next: "@pop" }],
      ],
      mlit: [
        [/[^']+/, "string"],
        [/'''/, { token: "string.quote", next: "@pop" }],
        [/'/, "string"],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration("toml", {
    comments: { lineComment: "#" },
    brackets: [
      ["[", "]"],
      ["{", "}"],
    ],
    autoClosingPairs: [
      { open: "[", close: "]" },
      { open: "{", close: "}" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: "[", close: "]" },
      { open: "{", close: "}" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
  monaco.editor.defineTheme("frp-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "a16207", fontStyle: "italic" },
      { token: "type.identifier", foreground: "c026d3", fontStyle: "bold" },
      { token: "key", foreground: "ea580c" },
      { token: "string", foreground: "15803d" },
      { token: "string.quote", foreground: "15803d" },
      { token: "string.escape", foreground: "b45309" },
      { token: "number", foreground: "db2777" },
      { token: "keyword", foreground: "dc2626" },
      { token: "operator", foreground: "78716c" },
      { token: "delimiter", foreground: "78716c" },
    ],
    colors: {
      "editor.background": "#fffdf7",
      "editor.lineHighlightBackground": "#fff7ed",
      "editorLineNumber.foreground": "#fcd9b6",
      "editorLineNumber.activeForeground": "#c2410c",
      "editorIndentGuide.background1": "#fde68a",
    },
  });
}

function emptyProxy(): ProxyForm {
  return {
    name: "",
    type: "https",
    customDomains: [],
    plugin: {
      type: "https2http",
      localAddr: "127.0.0.1:8080",
      crtPath: "./certs/ueware.crt",
      keyPath: "./certs/ueware.key",
      hostHeaderRewrite: "127.0.0.1",
      requestHeadersSet: { "x-from-where": "frp" },
    },
  };
}

function SectionTitle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        fontWeight: 600,
        color: "#7c2d12",
        margin: "4px 0 10px",
      }}
    >
      <span style={{ color: "#f97316" }}>{icon}</span>
      {text}
    </div>
  );
}

function DomainsEditor({
  value,
  onChange,
}: {
  value?: string[];
  onChange?: (v: string[]) => void;
}) {
  const [text, setText] = useState((value ?? []).join(", "));
  useEffect(() => {
    setText((value ?? []).join(", "));
  }, [value]);
  return (
    <Input
      value={text}
      placeholder="多个域名以逗号分隔，如 a.example.com, b.example.com"
      prefix={<GlobalOutlined style={{ color: "#94a3b8" }} />}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const arr = text
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        onChange?.(arr);
      }}
    />
  );
}

function HeadersEditor({
  value,
  onChange,
}: {
  value?: Record<string, string>;
  onChange?: (v: Record<string, string>) => void;
}) {
  const [rows, setRows] = useState<Array<[string, string]>>(
    Object.entries(value ?? {})
  );
  useEffect(() => setRows(Object.entries(value ?? {})), [value]);

  const update = (next: Array<[string, string]>) => {
    setRows(next);
    const obj: Record<string, string> = {};
    for (const [k, v] of next) {
      if (k) obj[k] = v;
    }
    onChange?.(obj);
  };

  return (
    <div>
      {rows.length === 0 && (
        <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 8 }}>
          暂无 Header，点击下方按钮添加
        </div>
      )}
      {rows.map(([k, v], i) => (
        <Row gutter={8} key={i} style={{ marginBottom: 6 }}>
          <Col flex="220px">
            <Input
              placeholder="header 名称"
              value={k}
              onChange={(e) => {
                const next = rows.slice();
                next[i] = [e.target.value, v];
                update(next);
              }}
            />
          </Col>
          <Col flex="auto">
            <Input
              placeholder="header 值"
              value={v}
              onChange={(e) => {
                const next = rows.slice();
                next[i] = [k, e.target.value];
                update(next);
              }}
            />
          </Col>
          <Col flex="none">
            <Button
              icon={<DeleteOutlined />}
              onClick={() => update(rows.filter((_, j) => j !== i))}
            />
          </Col>
        </Row>
      ))}
      <Button
        type="dashed"
        icon={<PlusOutlined />}
        onClick={() => update([...rows, ["", ""]])}
      >
        添加 Header
      </Button>
    </div>
  );
}

// 代理类型 -> 统一橙金暖色底 + 仅 Tag 色区分类型
const typeAccent: Record<string, { tag: string }> = {
  tcp:    { tag: "orange" },
  udp:    { tag: "gold" },
  http:   { tag: "volcano" },
  https:  { tag: "magenta" },
  tcpmux: { tag: "geekblue" },
  stcp:   { tag: "green" },
  sudp:   { tag: "cyan" },
  xtcp:   { tag: "purple" },
};

// 统一橙金卡片底色（全局一致）
const CHIP_BG = "linear-gradient(135deg,#ffffff 0%,#fff7ed 100%)";
const CHIP_BORDER = "#fed7aa";
const CHIP_TEXT = "#7c2d12";

// 代理紧凑卡：仅展示概要，点击打开 Drawer 详细编辑
function ProxyChip({
  index,
  proxy,
  onEdit,
  onRemove,
}: {
  index: number;
  proxy: ProxyForm;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const accent = typeAccent[proxy.type] ?? typeAccent.tcp;
  const f = featuresOf(proxy.type);
  const meta = proxyTypes.find((p) => p.value === proxy.type);

  // 概要信息行
  const summary: string[] = [];
  if (f.needCustomDomains && proxy.customDomains && proxy.customDomains.length > 0) {
    summary.push(
      proxy.customDomains[0] +
        (proxy.customDomains.length > 1 ? ` +${proxy.customDomains.length - 1}` : "")
    );
  }
  if (f.needRemotePort && proxy.remotePort != null) {
    summary.push(`远端 :${proxy.remotePort}`);
  }
  if (proxy.localPort != null) {
    summary.push(`本地 ${proxy.localIp ?? "127.0.0.1"}:${proxy.localPort}`);
  }
  if (f.needSecretKey && proxy.secretKey) {
    summary.push("🔑 已设密钥");
  }

  return (
    <div
      onClick={onEdit}
      style={{
        cursor: "pointer",
        padding: 14,
        borderRadius: 12,
        background: CHIP_BG,
        border: `1px solid ${CHIP_BORDER}`,
        boxShadow: "0 2px 8px rgba(234, 88, 12, 0.06)",
        transition: "transform .15s ease, box-shadow .15s ease",
        position: "relative",
        overflow: "hidden",
        minHeight: 110,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 6px 16px rgba(234, 88, 12, 0.16)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(234, 88, 12, 0.06)";
      }}
    >
      {/* 头部：序号 + 名称 + 类型 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Tag
          color="orange"
          style={{ margin: 0, fontWeight: 600, minWidth: 30, textAlign: "center" }}
        >
          #{index + 1}
        </Tag>
        <span
          style={{
            fontWeight: 600,
            fontSize: 14,
            color: CHIP_TEXT,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={proxy.name || "(未命名)"}
        >
          {proxy.name || "(未命名)"}
        </span>
        <Tag color={accent.tag} style={{ margin: 0, fontWeight: 600 }}>
          {meta?.label ?? proxy.type}
        </Tag>
      </div>

      {/* 概要 */}
      <div
        style={{
          fontSize: 12.5,
          color: "#57534e",
          lineHeight: 1.7,
          minHeight: 36,
        }}
      >
        {summary.length === 0 ? (
          <span style={{ color: "#a8a29e" }}>暂无路由信息，点击编辑 →</span>
        ) : (
          summary.map((s, i) => (
            <div
              key={i}
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={s}
            >
              {s}
            </div>
          ))
        )}
      </div>

      {/* 标签区 + 操作 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 10,
          paddingTop: 8,
          borderTop: `1px dashed ${CHIP_BORDER}`,
        }}
      >
        <Space size={4}>
          {proxy.plugin && proxy.plugin.type && proxy.plugin.type !== "none" && (
            <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>
              {proxy.plugin.type}
            </Tag>
          )}
          {proxy.useEncryption && (
            <Tooltip title="已启用加密">
              <Tag color="green" style={{ margin: 0, fontSize: 11 }}>
                E
              </Tag>
            </Tooltip>
          )}
          {proxy.useCompression && (
            <Tooltip title="已启用压缩">
              <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
                C
              </Tag>
            </Tooltip>
          )}
          {proxy.bandwidthLimit && (
            <Tag color="gold" style={{ margin: 0, fontSize: 11 }}>
              ⏱ {proxy.bandwidthLimit}
            </Tag>
          )}
        </Space>
        <Space size={4} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="编辑详情">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={onEdit}
            />
          </Tooltip>
          <Popconfirm title="删除该代理？" onConfirm={onRemove}>
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
        </Space>
      </div>
    </div>
  );
}

function ProxyCard({
  index,
  proxy,
  onChange,
  onRemove,
}: {
  index: number;
  proxy: ProxyForm;
  onChange: (p: ProxyForm) => void;
  onRemove: () => void;
}) {
  const f = featuresOf(proxy.type);
  const plugin: PluginForm = proxy.plugin ?? { type: "none" };
  const pf = pluginFeaturesOf(plugin.type);
  const setPlugin = (np: PluginForm | null) =>
    onChange({ ...proxy, plugin: np });

  const pickCert = async (which: "crt" | "key") => {
    const selected = await openDialog({
      multiple: false,
      filters: [
        {
          name: which === "crt" ? "证书" : "私钥",
          extensions: which === "crt" ? ["crt", "pem", "cer"] : ["key", "pem"],
        },
      ],
    });
    if (typeof selected === "string") {
      const rel = await api.certPickAndImport(selected);
      if (which === "crt") {
        setPlugin({ ...plugin, crtPath: rel });
      } else {
        setPlugin({ ...plugin, keyPath: rel });
      }
    }
  };

  const typeMeta = proxyTypes.find((p) => p.value === proxy.type);

  return (
    <Card
      variant="borderless"
      style={{
        borderRadius: 14,
        boxShadow: "0 4px 14px rgba(234, 88, 12, 0.08)",
        border: "1px solid rgba(255,237,213,0.9)",
        overflow: "hidden",
      }}
      styles={{
        header: {
          background:
            "linear-gradient(135deg,#fffbeb 0%,#fff7ed 100%)",
          borderBottom: "1px solid #fed7aa",
          padding: "10px 16px",
        },
        body: { padding: 16, background: "#fffdfa" },
      }}
      title={
        <Space>
          <Tag color="orange" style={{ margin: 0, fontWeight: 600 }}>
            #{index + 1}
          </Tag>
          <span style={{ fontWeight: 600, color: "#7c2d12" }}>
            {proxy.name || "(未命名)"}
          </span>
          <Tag color={typeAccent[proxy.type]?.tag ?? "orange"}>
            {typeMeta?.label ?? proxy.type}
          </Tag>
          {proxy.customDomains && proxy.customDomains.length > 0 && (
            <Tag color="gold">
              {proxy.customDomains[0]}
              {proxy.customDomains.length > 1
                ? ` +${proxy.customDomains.length - 1}`
                : ""}
            </Tag>
          )}
          {f.needRemotePort && proxy.remotePort != null && (
            <Tag color="volcano">:{proxy.remotePort}</Tag>
          )}
        </Space>
      }
      extra={
        <Popconfirm title="删除该代理？" onConfirm={onRemove}>
          <Button danger size="small" icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
      }
    >
      <SectionTitle icon={<ApiOutlined />} text="基础信息" />
      <Row gutter={12}>
        <Col xs={24} md={10}>
          <Form.Item label="代理名称 (name)">
            <Input
              value={proxy.name}
              placeholder="唯一名称，如 cake / ssh / web1"
              onChange={(e) => onChange({ ...proxy, name: e.target.value })}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={14}>
          <Form.Item
            label={
              <Space size={4}>
                <span>类型 (type)</span>
                {typeMeta && (
                  <Tooltip title={typeMeta.desc}>
                    <Tag color="orange" style={{ fontSize: 11, margin: 0 }}>
                      {typeMeta.desc}
                    </Tag>
                  </Tooltip>
                )}
              </Space>
            }
          >
            <Select
              value={proxy.type}
              onChange={(v) => onChange({ ...proxy, type: v })}
              options={proxyTypes.map((t) => ({
                value: t.value,
                label: (
                  <Space>
                    <span style={{ fontWeight: 600 }}>{t.label}</span>
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>
                      {t.desc}
                    </span>
                  </Space>
                ),
              }))}
            />
          </Form.Item>
        </Col>
      </Row>

      {/* 网络配置 */}
      <SectionTitle icon={<GlobalOutlined />} text="网络配置" />
      <Row gutter={12}>
        {f.needCustomDomains && (
          <Col xs={24} md={f.needSubdomain ? 16 : 24}>
            <Form.Item label="自定义域名 (customDomains)">
              <DomainsEditor
                value={proxy.customDomains}
                onChange={(v) => onChange({ ...proxy, customDomains: v })}
              />
            </Form.Item>
          </Col>
        )}
        {f.needSubdomain && (
          <Col xs={24} md={f.needCustomDomains ? 8 : 24}>
            <Form.Item label="子域名 (subdomain)">
              <Input
                value={proxy.subdomain ?? ""}
                placeholder="可选，需服务端配置 subdomainHost"
                onChange={(e) =>
                  onChange({ ...proxy, subdomain: e.target.value || null })
                }
              />
            </Form.Item>
          </Col>
        )}
      </Row>

      {f.needMultiplexer && (
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item label="复用器 (multiplexer)">
              <Select
                value={proxy.multiplexer ?? "httpconnect"}
                onChange={(v) => onChange({ ...proxy, multiplexer: v })}
                options={[
                  { value: "httpconnect", label: "httpconnect" },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="按 HTTP 用户路由 (routeByHTTPUser)">
              <Input
                value={proxy.routeByHttpUser ?? ""}
                placeholder="可选，仅 tcpmux 生效"
                onChange={(e) =>
                  onChange({ ...proxy, routeByHttpUser: e.target.value || null })
                }
              />
            </Form.Item>
          </Col>
        </Row>
      )}

      {f.needLocations && (
        <Row gutter={12}>
          <Col span={24}>
            <Form.Item label="路径匹配 (locations)">
              <DomainsEditor
                value={proxy.locations}
                onChange={(v) => onChange({ ...proxy, locations: v })}
              />
            </Form.Item>
          </Col>
        </Row>
      )}

      {f.needHttpAuth && (
        <Row gutter={12}>
          <Col xs={12} md={12}>
            <Form.Item label="HTTP 用户名 (httpUser)">
              <Input
                value={proxy.httpUser ?? ""}
                prefix={<UserOutlined style={{ color: "#94a3b8" }} />}
                placeholder="可选"
                onChange={(e) =>
                  onChange({ ...proxy, httpUser: e.target.value || null })
                }
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={12}>
            <Form.Item label="HTTP 密码 (httpPassword)">
              <Input.Password
                value={proxy.httpPassword ?? ""}
                prefix={<LockOutlined style={{ color: "#94a3b8" }} />}
                placeholder="可选"
                onChange={(e) =>
                  onChange({ ...proxy, httpPassword: e.target.value || null })
                }
              />
            </Form.Item>
          </Col>
        </Row>
      )}

      {f.needHostHeaderRewrite && (
        <Row gutter={12}>
          <Col span={24}>
            <Form.Item label="hostHeaderRewrite">
              <Input
                value={proxy.hostHeaderRewrite ?? ""}
                placeholder="重写请求 Host 头，可选"
                onChange={(e) =>
                  onChange({
                    ...proxy,
                    hostHeaderRewrite: e.target.value || null,
                  })
                }
              />
            </Form.Item>
          </Col>
        </Row>
      )}

      {f.needSecretKey && (
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item label="密钥 (secretKey)">
              <Input.Password
                value={proxy.secretKey ?? ""}
                prefix={<KeyOutlined style={{ color: "#94a3b8" }} />}
                placeholder="与访问端共享的密钥"
                onChange={(e) =>
                  onChange({ ...proxy, secretKey: e.target.value || null })
                }
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="允许访问用户 (allowUsers)">
              <DomainsEditor
                value={proxy.allowUsers}
                onChange={(v) => onChange({ ...proxy, allowUsers: v })}
              />
            </Form.Item>
          </Col>
        </Row>
      )}

      {f.needLocal && (
        <Row gutter={12}>
          <Col xs={24} md={f.needRemotePort ? 12 : 16}>
            <Form.Item label="本地 IP (localIP)">
              <Input
                value={proxy.localIp ?? ""}
                placeholder="127.0.0.1"
                onChange={(e) =>
                  onChange({ ...proxy, localIp: e.target.value || null })
                }
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={f.needRemotePort ? 6 : 8}>
            <Form.Item label="本地端口 (localPort)">
              <InputNumber
                min={0}
                max={65535}
                style={{ width: "100%" }}
                placeholder="8080"
                value={proxy.localPort ?? undefined}
                onChange={(v) =>
                  onChange({ ...proxy, localPort: (v as number) ?? null })
                }
              />
            </Form.Item>
          </Col>
          {f.needRemotePort && (
            <Col xs={12} md={6}>
              <Form.Item label="远端端口 (remotePort)">
                <InputNumber
                  min={0}
                  max={65535}
                  style={{ width: "100%" }}
                  placeholder="服务端暴露端口"
                  value={proxy.remotePort ?? undefined}
                  onChange={(v) =>
                    onChange({ ...proxy, remotePort: (v as number) ?? null })
                  }
                />
              </Form.Item>
            </Col>
          )}
        </Row>
      )}

      {/* 传输选项 */}
      <SectionTitle icon={<ThunderboltOutlined />} text="传输选项 (可选)" />
      <Row gutter={12} align="middle">
        <Col xs={12} md={6}>
          <Form.Item label="加密 (useEncryption)">
            <Switch
              checked={!!proxy.useEncryption}
              onChange={(v) =>
                onChange({ ...proxy, useEncryption: v ? true : null })
              }
            />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label="压缩 (useCompression)">
            <Switch
              checked={!!proxy.useCompression}
              onChange={(v) =>
                onChange({ ...proxy, useCompression: v ? true : null })
              }
            />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label="限速 (bandwidthLimit)">
            <Input
              value={proxy.bandwidthLimit ?? ""}
              placeholder="如 1MB / 200KB"
              onChange={(e) =>
                onChange({
                  ...proxy,
                  bandwidthLimit: e.target.value || null,
                })
              }
            />
          </Form.Item>
        </Col>
        <Col xs={12} md={6}>
          <Form.Item label="限速模式">
            <Select
              allowClear
              value={proxy.bandwidthLimitMode ?? undefined}
              placeholder="client / server"
              onChange={(v) =>
                onChange({ ...proxy, bandwidthLimitMode: v ?? null })
              }
              options={[
                { value: "client", label: "client" },
                { value: "server", label: "server" },
              ]}
            />
          </Form.Item>
        </Col>
      </Row>

      {/* 插件 */}
      {f.canPlugin && (
        <>
          <SectionTitle
            icon={<SafetyCertificateOutlined />}
            text="插件 (plugin)"
          />
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item label="plugin.type">
                <Select
                  value={plugin.type || "none"}
                  onChange={(v) =>
                    v === "none"
                      ? setPlugin(null)
                      : setPlugin({ ...plugin, type: v })
                  }
                  options={pluginTypes.map((t) => ({
                    value: t.value,
                    label: t.label,
                  }))}
                />
              </Form.Item>
            </Col>
            {pf.needLocalAddr && (
              <Col xs={24} md={12}>
                <Form.Item label="本地服务地址 (localAddr)">
                  <Input
                    value={plugin.localAddr ?? ""}
                    prefix={<ApiOutlined style={{ color: "#94a3b8" }} />}
                    onChange={(e) =>
                      setPlugin({ ...plugin, localAddr: e.target.value })
                    }
                    placeholder="127.0.0.1:8080"
                  />
                </Form.Item>
              </Col>
            )}
          </Row>

          {pf.needCert && (
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Form.Item label="证书路径 (crtPath)">
                  <Space.Compact style={{ width: "100%" }}>
                    <Input
                      value={plugin.crtPath ?? ""}
                      prefix={
                        <SafetyCertificateOutlined
                          style={{ color: "#94a3b8" }}
                        />
                      }
                      placeholder="./certs/xxx.crt"
                      onChange={(e) =>
                        setPlugin({ ...plugin, crtPath: e.target.value })
                      }
                    />
                    <Button
                      icon={<FolderOpenOutlined />}
                      onClick={() => pickCert("crt")}
                    >
                      选择
                    </Button>
                  </Space.Compact>
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item label="私钥路径 (keyPath)">
                  <Space.Compact style={{ width: "100%" }}>
                    <Input
                      value={plugin.keyPath ?? ""}
                      prefix={
                        <KeyOutlined style={{ color: "#94a3b8" }} />
                      }
                      placeholder="./certs/xxx.key"
                      onChange={(e) =>
                        setPlugin({ ...plugin, keyPath: e.target.value })
                      }
                    />
                    <Button
                      icon={<FolderOpenOutlined />}
                      onClick={() => pickCert("key")}
                    >
                      选择
                    </Button>
                  </Space.Compact>
                </Form.Item>
              </Col>
            </Row>
          )}

          {pf.needHostHeaderRewrite && (
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Form.Item label="hostHeaderRewrite">
                  <Input
                    value={plugin.hostHeaderRewrite ?? ""}
                    placeholder="127.0.0.1"
                    onChange={(e) =>
                      setPlugin({
                        ...plugin,
                        hostHeaderRewrite: e.target.value,
                      })
                    }
                  />
                </Form.Item>
              </Col>
            </Row>
          )}

          {pf.needRequestHeaders && (
            <Form.Item
              label="请求头重写 (requestHeaders.set)"
              style={{ marginBottom: 0 }}
            >
              <HeadersEditor
                value={plugin.requestHeadersSet ?? {}}
                onChange={(v) =>
                  setPlugin({ ...plugin, requestHeadersSet: v })
                }
              />
            </Form.Item>
          )}

          {pf.needUnixPath && (
            <Row gutter={12}>
              <Col span={24}>
                <Form.Item label="Unix 套接字路径 (unixPath)">
                  <Input
                    value={plugin.unixPath ?? ""}
                    placeholder="/var/run/docker.sock"
                    onChange={(e) =>
                      setPlugin({ ...plugin, unixPath: e.target.value })
                    }
                  />
                </Form.Item>
              </Col>
            </Row>
          )}

          {pf.needStaticFile && (
            <Row gutter={12}>
              <Col xs={24} md={16}>
                <Form.Item label="本地路径 (localPath)">
                  <Input
                    value={plugin.localPath ?? ""}
                    placeholder="/data/www"
                    onChange={(e) =>
                      setPlugin({ ...plugin, localPath: e.target.value })
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="URL 前缀剩除 (stripPrefix)">
                  <Input
                    value={plugin.stripPrefix ?? ""}
                    placeholder="可选，如 static"
                    onChange={(e) =>
                      setPlugin({ ...plugin, stripPrefix: e.target.value })
                    }
                  />
                </Form.Item>
              </Col>
            </Row>
          )}

          {pf.needHttpAuth && (
            <Row gutter={12}>
              <Col xs={12} md={12}>
                <Form.Item label="插件用户名 (httpUser)">
                  <Input
                    value={plugin.httpUser ?? ""}
                    prefix={<UserOutlined style={{ color: "#94a3b8" }} />}
                    onChange={(e) =>
                      setPlugin({ ...plugin, httpUser: e.target.value })
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={12} md={12}>
                <Form.Item label="插件密码 (httpPassword)">
                  <Input.Password
                    value={plugin.httpPassword ?? ""}
                    prefix={<LockOutlined style={{ color: "#94a3b8" }} />}
                    onChange={(e) =>
                      setPlugin({ ...plugin, httpPassword: e.target.value })
                    }
                  />
                </Form.Item>
              </Col>
            </Row>
          )}

          {pf.needSocks5Auth && (
            <Row gutter={12}>
              <Col xs={12} md={12}>
                <Form.Item label="SOCKS5 用户名 (username)">
                  <Input
                    value={plugin.username ?? ""}
                    prefix={<UserOutlined style={{ color: "#94a3b8" }} />}
                    onChange={(e) =>
                      setPlugin({ ...plugin, username: e.target.value })
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={12} md={12}>
                <Form.Item label="SOCKS5 密码 (password)">
                  <Input.Password
                    value={plugin.password ?? ""}
                    prefix={<LockOutlined style={{ color: "#94a3b8" }} />}
                    onChange={(e) =>
                      setPlugin({ ...plugin, password: e.target.value })
                    }
                  />
                </Form.Item>
              </Col>
            </Row>
          )}
        </>
      )}

      {proxy.type === "https" && plugin.type === "none" && (
        <Alert
          type="info"
          showIcon
          message="如需在 frpc 侧终结 TLS，可使用 https2http 插件并指定证书"
          style={{ marginTop: 8 }}
        />
      )}
    </Card>
  );
}

export default function Config() {
  const [form, setForm] = useState<FrpcForm | null>(null);
  const [toml, setToml] = useState<string>("");
  const [tab, setTab] = useState<"form" | "source">("form");
  const [loading, setLoading] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const load = async () => {
    const text = await api.configLoad();
    setToml(text);
    try {
      const f = await api.configParseToForm(text);
      setForm(f);
    } catch (e) {
      message.error("TOML 解析失败: " + e);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const onFormChange = (f: FrpcForm) => {
    setForm(f);
  };

  const switchTab = async (t: string) => {
    if (t === "source" && form) {
      try {
        const text = await api.configFormToDoc(form);
        setToml(text);
      } catch (e) {
        message.error(String(e));
        return;
      }
    }
    if (t === "form") {
      try {
        const f = await api.configParseToForm(toml);
        setForm(f);
      } catch (e) {
        message.error("无法从 TOML 解析为表单: " + e);
        return;
      }
    }
    setTab(t as "form" | "source");
  };

  const save = async () => {
    setLoading(true);
    try {
      let text = toml;
      if (tab === "form" && form) {
        text = await api.configFormToDoc(form);
        setToml(text);
      }
      await api.configSave(text);
      message.success("已保存");
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  const addProxy = () => {
    if (!form) return;
    const next = [...form.proxies, emptyProxy()];
    setForm({ ...form, proxies: next });
    // 新增后立即打开详情抽屉
    setEditingIndex(next.length - 1);
  };

  if (!form) {
    return (
      <Card variant="borderless" style={{ borderRadius: 12 }}>
        <Empty description="加载配置中..." />
      </Card>
    );
  }

  return (
    <Form layout="vertical" size="middle">
      <Card
        variant="borderless"
        style={{
          borderRadius: 14,
          marginBottom: 14,
          boxShadow: "0 4px 14px rgba(234, 88, 12, 0.08)",
          border: "1px solid rgba(255,237,213,0.9)",
          background:
            "linear-gradient(135deg,#ffffff 0%,#fff7ed 100%)",
        }}
        styles={{ body: { padding: 14 } }}
      >
        <Space wrap>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={loading}
            onClick={save}
          >
            保存
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load}>
            重新加载
          </Button>
        </Space>
      </Card>

      <Tabs
        activeKey={tab}
        onChange={switchTab}
        size="large"
        tabBarStyle={{ marginBottom: 14 }}
        items={[
          {
            key: "form",
            label: (
              <span>
                <FormOutlined /> 表单视图
              </span>
            ),
            children: (
              <>
                <Card
                  variant="borderless"
                  title={
                    <Space>
                      <CloudServerOutlined style={{ color: "#f97316" }} />
                      <span style={{ color: "#7c2d12" }}>服务端连接</span>
                    </Space>
                  }
                  style={{
                    marginBottom: 14,
                    borderRadius: 14,
                    boxShadow: "0 4px 14px rgba(234, 88, 12, 0.08)",
                    border: "1px solid rgba(255,237,213,0.9)",
                  }}
                  styles={{
                    header: {
                      borderBottom: "1px solid #ffedd5",
                      padding: "10px 16px",
                    },
                    body: { padding: 16 },
                  }}
                >
                  <Row gutter={12}>
                    <Col xs={24} md={10}>
                      <Form.Item label="服务器地址 (serverAddr)">
                        <Input
                          value={form.serverAddr}
                          prefix={
                            <GlobalOutlined style={{ color: "#94a3b8" }} />
                          }
                          placeholder="frps.example.com"
                          onChange={(e) =>
                            onFormChange({
                              ...form,
                              serverAddr: e.target.value,
                            })
                          }
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item label="端口 (serverPort)">
                        <InputNumber
                          min={1}
                          max={65535}
                          style={{ width: "100%" }}
                          value={form.serverPort}
                          onChange={(v) =>
                            onFormChange({
                              ...form,
                              serverPort: Number(v ?? 7000),
                            })
                          }
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="认证 Token (auth.token)">
                        <Input.Password
                          value={form.auth.token ?? ""}
                          prefix={
                            <LockOutlined style={{ color: "#94a3b8" }} />
                          }
                          placeholder="与 frps 配置保持一致"
                          onChange={(e) =>
                            onFormChange({
                              ...form,
                              auth: { token: e.target.value || null },
                            })
                          }
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <Space>
                    <ApiOutlined style={{ color: "#f97316" }} />
                    <span style={{ fontWeight: 600, color: "#7c2d12" }}>
                      代理列表
                    </span>
                    <Tag color="orange">{form.proxies.length}</Tag>
                  </Space>
                </div>

                {form.proxies.length === 0 ? (
                  <div
                    style={{
                      padding: "32px 0",
                      textAlign: "center",
                      color: "#a8a29e",
                      background:
                        "linear-gradient(135deg,#fffbeb 0%,#fff7ed 100%)",
                      borderRadius: 12,
                      border: "1px dashed #fed7aa",
                      marginBottom: 12,
                    }}
                  >
                    暂未配置代理，点击下方「新增代理」开始
                  </div>
                ) : (
                  <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                    {form.proxies.map((p, i) => (
                      <Col xs={24} sm={12} xl={8} key={i}>
                        <ProxyChip
                          index={i}
                          proxy={p}
                          onEdit={() => setEditingIndex(i)}
                          onRemove={() =>
                            onFormChange({
                              ...form,
                              proxies: form.proxies.filter(
                                (_, j) => j !== i
                              ),
                            })
                          }
                        />
                      </Col>
                    ))}
                  </Row>
                )}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={addProxy}
                  style={{ height: 44, borderRadius: 12 }}
                >
                  新增代理
                </Button>
              </>
            ),
          },
          {
            key: "source",
            label: (
              <span>
                <CodeOutlined /> 源码视图
              </span>
            ),
            children: (
              <Card
                variant="borderless"
                style={{
                  borderRadius: 12,
                  boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06)",
                  overflow: "hidden",
                }}
                styles={{ body: { padding: 0 } }}
              >
                <div style={{ height: 560 }}>
                  <Editor
                    language="toml"
                    theme="frp-light"
                    value={toml}
                    onChange={(v) => setToml(v ?? "")}
                    beforeMount={registerTomlLanguage}
                    options={{
                      fontSize: 13,
                      fontFamily:
                        "ui-monospace, Menlo, 'JetBrains Mono', Consolas, monospace",
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      padding: { top: 12, bottom: 12 },
                      lineNumbers: "on",
                      roundedSelection: true,
                      renderLineHighlight: "all",
                      smoothScrolling: true,
                      cursorBlinking: "smooth",
                      bracketPairColorization: { enabled: true },
                      guides: { indentation: true },
                    }}
                  />
                </div>
              </Card>
            ),
          },
        ]}
      />

      {/* 代理详情编辑抽屉 */}
      <Drawer
        title={
          editingIndex != null && form.proxies[editingIndex] ? (
            <Space>
              <ApiOutlined style={{ color: "#f97316" }} />
              <span style={{ fontWeight: 600, color: "#7c2d12" }}>
                编辑代理 #{editingIndex + 1}
              </span>
              <Tag color="orange" style={{ margin: 0 }}>
                {form.proxies[editingIndex].name || "(未命名)"}
              </Tag>
            </Space>
          ) : (
            "编辑代理"
          )
        }
        placement="right"
        width={760}
        open={editingIndex != null}
        onClose={() => setEditingIndex(null)}
        destroyOnHidden
        styles={{
          header: {
            background:
              "linear-gradient(135deg,#fffbeb 0%,#fff7ed 100%)",
            borderBottom: "1px solid #fed7aa",
          },
          body: { padding: 16, background: "#fffaf0" },
        }}
      >
        {editingIndex != null && form.proxies[editingIndex] && (
          <ProxyCard
            index={editingIndex}
            proxy={form.proxies[editingIndex]}
            onChange={(np) => {
              const next = form.proxies.slice();
              next[editingIndex] = np;
              onFormChange({ ...form, proxies: next });
            }}
            onRemove={() => {
              onFormChange({
                ...form,
                proxies: form.proxies.filter((_, j) => j !== editingIndex),
              });
              setEditingIndex(null);
            }}
          />
        )}
      </Drawer>
    </Form>
  );
}
