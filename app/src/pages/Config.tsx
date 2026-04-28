import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Tabs,
  Tag,
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
} from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, FrpcForm, PluginForm, ProxyForm } from "../api/tauri";

const proxyTypes = ["tcp", "udp", "http", "https", "stcp", "xtcp"];
const pluginTypes = ["none", "https2http", "http2https", "static_file", "socks5"];

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
  const isHttps = proxy.type === "https";
  const plugin: PluginForm = proxy.plugin ?? { type: "none" };
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

  return (
    <Card
      variant="borderless"
      style={{
        marginBottom: 14,
        borderRadius: 14,
        boxShadow: "0 4px 14px rgba(234, 88, 12, 0.08)",
        border: "1px solid rgba(255,237,213,0.9)",
        overflow: "hidden",
      }}
      styles={{
        header: {
          background:
            "linear-gradient(90deg,#fff7ed 0%,#ffedd5 45%,#fef3c7 100%)",
          borderBottom: "1px solid #fde68a",
          padding: "10px 16px",
        },
        body: { padding: 16, background: "#fffdfa" },
      }}
      title={
        <Space>
          <Tag color="geekblue" style={{ margin: 0 }}>
            #{index + 1}
          </Tag>
          <span style={{ fontWeight: 600 }}>{proxy.name || "(未命名)"}</span>
          <Tag color="blue">{proxy.type}</Tag>
          {proxy.customDomains && proxy.customDomains.length > 0 && (
            <Tag>{proxy.customDomains[0]}{proxy.customDomains.length > 1 ? ` +${proxy.customDomains.length - 1}` : ""}</Tag>
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
        <Col xs={24} md={8}>
          <Form.Item label="代理名称 (name)">
            <Input
              value={proxy.name}
              placeholder="唯一名称，如 cake"
              onChange={(e) => onChange({ ...proxy, name: e.target.value })}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item label="类型 (type)">
            <Select
              value={proxy.type}
              onChange={(v) => onChange({ ...proxy, type: v })}
              options={proxyTypes.map((t) => ({ label: t, value: t }))}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={10}>
          <Form.Item label="自定义域名 (customDomains)">
            <DomainsEditor
              value={proxy.customDomains}
              onChange={(v) => onChange({ ...proxy, customDomains: v })}
            />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item label="localIP">
            <Input
              value={proxy.localIp ?? ""}
              placeholder="127.0.0.1"
              onChange={(e) =>
                onChange({ ...proxy, localIp: e.target.value || null })
              }
            />
          </Form.Item>
        </Col>
        <Col xs={12} md={4}>
          <Form.Item label="localPort">
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
        <Col xs={12} md={4}>
          <Form.Item label="remotePort">
            <InputNumber
              min={0}
              max={65535}
              style={{ width: "100%" }}
              value={proxy.remotePort ?? undefined}
              onChange={(v) =>
                onChange({ ...proxy, remotePort: (v as number) ?? null })
              }
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item label="subdomain">
            <Input
              value={proxy.subdomain ?? ""}
              placeholder="可选"
              onChange={(e) =>
                onChange({ ...proxy, subdomain: e.target.value || null })
              }
            />
          </Form.Item>
        </Col>
      </Row>

      <SectionTitle icon={<SafetyCertificateOutlined />} text="插件 (plugin)" />
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item label="plugin.type">
            <Select
              value={plugin.type || "none"}
              onChange={(v) =>
                v === "none"
                  ? setPlugin(null)
                  : setPlugin({ ...plugin, type: v })
              }
              options={pluginTypes.map((t) => ({ label: t, value: t }))}
            />
          </Form.Item>
        </Col>
        {plugin.type && plugin.type !== "none" && (
          <Col xs={24} md={16}>
            <Form.Item label="localAddr">
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

      {plugin.type === "https2http" && (
        <>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item label="证书路径 (crtPath)">
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={plugin.crtPath ?? ""}
                    prefix={
                      <SafetyCertificateOutlined style={{ color: "#94a3b8" }} />
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
                    prefix={<KeyOutlined style={{ color: "#94a3b8" }} />}
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
          <Form.Item
            label="请求头重写 (requestHeaders.set)"
            style={{ marginBottom: 0 }}
          >
            <HeadersEditor
              value={plugin.requestHeadersSet ?? {}}
              onChange={(v) => setPlugin({ ...plugin, requestHeadersSet: v })}
            />
          </Form.Item>
        </>
      )}

      {isHttps && !plugin.type && (
        <Alert
          type="warning"
          showIcon
          message="建议使用 https2http 插件以内置证书，便于端到端 HTTPS"
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
    setForm({ ...form, proxies: [...form.proxies, emptyProxy()] });
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

                {form.proxies.map((p, i) => (
                  <ProxyCard
                    key={i}
                    index={i}
                    proxy={p}
                    onChange={(np) => {
                      const next = form.proxies.slice();
                      next[i] = np;
                      onFormChange({ ...form, proxies: next });
                    }}
                    onRemove={() =>
                      onFormChange({
                        ...form,
                        proxies: form.proxies.filter((_, j) => j !== i),
                      })
                    }
                  />
                ))}
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
    </Form>
  );
}
