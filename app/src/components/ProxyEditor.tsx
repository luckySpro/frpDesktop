import { useEffect, useMemo, useState } from "react";
import {
  App,
  AutoComplete,
  Button,
  Collapse,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
} from "antd";
import { DeleteOutlined, ImportOutlined, PlusOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import type { CertFile, PluginForm, ProxyForm } from "../api/types";
import { api, errText, isTauri, pickFiles } from "../api/tauri";
import { useApp } from "../store/app";
import {
  emptyPlugin,
  featuresOf,
  nameMatches,
  PLUGIN_TYPES,
  pluginFeaturesOf,
  PROXY_TYPES,
  suggestCert,
} from "../lib/proxy";

function HeadersEditor({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(value));
  const commit = (next: [string, string][]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter(([k]) => k.trim())));
  };
  return (
    <div>
      {rows.map(([k, v], i) => (
        <Space.Compact key={i} style={{ width: "100%", marginBottom: 6 }}>
          <Input
            style={{ width: "42%" }}
            placeholder="Header 名称，如 x-from-where"
            value={k}
            onChange={(e) => commit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
          />
          <Input
            placeholder="值"
            value={v}
            onChange={(e) => commit(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
          />
          <Button icon={<DeleteOutlined />} aria-label="删除 Header" onClick={() => commit(rows.filter((_, j) => j !== i))} />
        </Space.Compact>
      ))}
      <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => setRows([...rows, ["", ""]])}>
        添加请求头
      </Button>
    </div>
  );
}

/** Choose a certificate from the library (key is filled from its pair). */
function CertPicker({
  plugin,
  domains,
  onChange,
}: {
  plugin: PluginForm;
  domains: string[];
  onChange: (crt: string | null, key: string | null) => void;
}) {
  const { message } = App.useApp();
  const certs = useApp((s) => s.certs);
  const refreshCerts = useApp((s) => s.refreshCerts);
  const [manual, setManual] = useState(false);
  const library = certs.filter((c) => c.kind === "cert" && c.cert);
  const selected = library.find((c) => c.configPath === plugin.crtPath);
  const inLibrary = !plugin.crtPath || !!selected;

  const importFiles = async () => {
    const files = await pickFiles({ title: "选择证书和私钥（可多选）", multiple: true, extensions: ["crt", "pem", "cer", "key"] });
    if (!files.length) return;
    try {
      await api.certsImport(files);
      await refreshCerts();
      const fresh = useApp.getState().certs;
      const best = suggestCert(fresh, domains);
      if (best) onChange(best.configPath, `./certs/${best.pair}`);
      message.success(`已导入 ${files.length} 个文件`);
    } catch (e) {
      message.error(errText(e));
    }
  };

  const covers = (c: CertFile) => domains.length > 0 && domains.every((d) => c.cert!.dnsNames.some((n) => nameMatches(n, d)));

  if (manual || !inLibrary) {
    return (
      <>
        <Form.Item label="证书路径 (crtPath)" help="相对路径以应用数据目录为基准，推荐用证书库管理">
          <Input className="mono" value={plugin.crtPath ?? ""} onChange={(e) => onChange(e.target.value || null, plugin.keyPath ?? null)} />
        </Form.Item>
        <Form.Item label="私钥路径 (keyPath)">
          <Input className="mono" value={plugin.keyPath ?? ""} onChange={(e) => onChange(plugin.crtPath ?? null, e.target.value || null)} />
        </Form.Item>
        <Button size="small" type="link" onClick={() => setManual(false)} style={{ padding: 0 }}>
          从证书库选择
        </Button>
      </>
    );
  }

  return (
    <Form.Item
      label="SSL 证书"
      help={
        selected?.pair
          ? `私钥：${selected.pair}（已自动配对）`
          : selected
            ? "证书库中没有与该证书匹配的私钥，请导入私钥"
            : "未选择证书时 frpc 会使用自签名证书，浏览器会提示不安全"
      }
      validateStatus={selected && !selected.pair ? "error" : undefined}
    >
      <Space.Compact style={{ width: "100%" }}>
        <Select
          allowClear
          placeholder={library.length ? "从证书库选择" : "证书库为空，先导入证书"}
          value={selected?.configPath}
          onChange={(v) => {
            const c = library.find((x) => x.configPath === v);
            onChange(c?.configPath ?? null, c?.pair ? `./certs/${c.pair}` : null);
          }}
          options={library.map((c) => ({
            value: c.configPath,
            label: (
              <Space size={6}>
                <SafetyCertificateOutlined />
                <span>{c.cert!.dnsNames.join(", ")}</span>
                <span className="faint">{c.fileName}</span>
                {covers(c) && <Tag color="success">匹配</Tag>}
                {c.cert!.daysLeft < 0 ? <Tag color="error">已过期</Tag> : c.cert!.daysLeft <= 15 && <Tag color="warning">{c.cert!.daysLeft} 天</Tag>}
              </Space>
            ),
          }))}
        />
        {isTauri && (
          <Tooltip title="导入证书和私钥文件">
            <Button icon={<ImportOutlined />} onClick={importFiles} aria-label="导入证书" />
          </Tooltip>
        )}
      </Space.Compact>
      <Button size="small" type="link" onClick={() => setManual(true)} style={{ padding: 0, marginTop: 4 }}>
        手动填写路径
      </Button>
    </Form.Item>
  );
}

function LocalAddrInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <AutoComplete
      value={value}
      onChange={onChange}
      options={["127.0.0.1:8080", "127.0.0.1:3000", "127.0.0.1:5173", "127.0.0.1:80"].map((v) => ({ value: v }))}
    >
      <Input className="mono" placeholder="127.0.0.1:8080" />
    </AutoComplete>
  );
}

export default function ProxyEditor({
  open,
  initial,
  isNew,
  existingNames,
  onClose,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  initial: ProxyForm | null;
  isNew: boolean;
  existingNames: string[];
  onClose: () => void;
  onSubmit: (p: ProxyForm) => void;
  onDelete?: () => void;
}) {
  const certs = useApp((s) => s.certs);
  const [p, setP] = useState<ProxyForm | null>(initial);
  const [nameTouched, setNameTouched] = useState(false);

  useEffect(() => {
    setP(initial);
    setNameTouched(!!initial?.name);
  }, [initial, open]);

  const nameError = useMemo(() => {
    if (!p) return undefined;
    if (!p.name.trim()) return "请填写名称";
    if (existingNames.includes(p.name.trim())) return "名称已存在";
    return undefined;
  }, [p, existingNames]);

  if (!p) return null;
  const f = featuresOf(p.type);
  const plugin = p.plugin ?? emptyPlugin("none");
  const pf = pluginFeaturesOf(plugin.type);
  const set = (patch: Partial<ProxyForm>) => setP({ ...p, ...patch });
  const setPlugin = (patch: Partial<PluginForm>) => set({ plugin: { ...plugin, ...patch } });

  const setDomains = (domains: string[]) => {
    const clean = domains.map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "")).filter(Boolean);
    const patch: Partial<ProxyForm> = { customDomains: clean };
    if (!nameTouched) patch.name = clean[0] ?? "";
    let nextPlugin = plugin;
    if (pf.cert && !plugin.crtPath) {
      const best = suggestCert(certs, clean);
      if (best) nextPlugin = { ...plugin, crtPath: best.configPath, keyPath: `./certs/${best.pair}` };
    }
    setP({ ...p, ...patch, plugin: nextPlugin });
  };

  const changeType = (type: string) => {
    const tf = featuresOf(type);
    let nextPlugin: PluginForm | null = p.plugin ?? null;
    if (type === "https" && (!nextPlugin || nextPlugin.type === "none")) {
      nextPlugin = { type: "https2http", localAddr: "127.0.0.1:8080", hostHeaderRewrite: "127.0.0.1", requestHeadersSet: { "x-from-where": "frp" } };
    }
    if (!tf.plugin) nextPlugin = null;
    set({ type, plugin: nextPlugin, localIp: p.localIp ?? "127.0.0.1" });
  };

  const changePlugin = (type: string) => {
    if (type === "none") return set({ plugin: null, localIp: p.localIp ?? "127.0.0.1" });
    const base = emptyPlugin(type);
    const keep = pluginFeaturesOf(type);
    if (keep.localAddr) base.localAddr = plugin.localAddr ?? "127.0.0.1:8080";
    if (keep.hostRewrite) base.hostHeaderRewrite = plugin.hostHeaderRewrite ?? "127.0.0.1";
    if (keep.headers) base.requestHeadersSet = plugin.requestHeadersSet ?? {};
    if (keep.cert) {
      base.crtPath = plugin.crtPath;
      base.keyPath = plugin.keyPath;
    }
    set({ plugin: base });
  };

  const onLocalAddr = (v: string) => {
    const ip = v.split(":")[0];
    const patch: Partial<PluginForm> = { localAddr: v };
    // Keep hostHeaderRewrite following the local IP unless the user changed it.
    const oldIp = (plugin.localAddr ?? "").split(":")[0];
    if (pf.hostRewrite && (!plugin.hostHeaderRewrite || plugin.hostHeaderRewrite === oldIp) && ip) patch.hostHeaderRewrite = ip;
    setPlugin(patch);
  };

  const hasPlugin = !!p.plugin && p.plugin.type !== "none";
  const submit = () => {
    if (nameError) return;
    onSubmit(p);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={Math.min(620, typeof window !== "undefined" ? window.innerWidth : 620)}
      title={isNew ? (p.type === "https" ? "新建 HTTPS 站点" : "新建代理") : `编辑 ${initial?.name}`}
      destroyOnClose
      extra={
        <Space>
          {onDelete && (
            <Button danger icon={<DeleteOutlined />} onClick={onDelete}>
              删除
            </Button>
          )}
          <Button type="primary" onClick={submit} disabled={!!nameError}>
            {isNew ? "添加" : "完成"}
          </Button>
        </Space>
      }
    >
      <Form layout="vertical" requiredMark={false} onFinish={submit}>
        <div className="section-title">基本</div>
        <div className="row-2">
          <Form.Item label="类型">
            <Select
              value={p.type}
              onChange={changeType}
              options={PROXY_TYPES.map((t) => ({ value: t.value, label: `${t.label} · ${t.desc}` }))}
              popupMatchSelectWidth={false}
            />
          </Form.Item>
          <Form.Item label="名称" validateStatus={nameError ? "error" : undefined} help={nameError ?? "唯一标识，日志中会显示"}>
            <Input
              value={p.name}
              placeholder={f.vhost ? "默认使用第一个域名" : "如 ssh"}
              onChange={(e) => {
                setNameTouched(true);
                set({ name: e.target.value });
              }}
            />
          </Form.Item>
        </div>

        {f.vhost && (
          <>
            <div className="section-title">访问地址</div>
            <Form.Item
              label="自定义域名 (customDomains)"
              help="域名需解析到 frps 服务器。只填主机名，回车添加多个"
            >
              <Select
                mode="tags"
                value={p.customDomains}
                onChange={setDomains}
                tokenSeparators={[",", " "]}
                placeholder="app.example.com"
                open={false}
                suffixIcon={null}
              />
            </Form.Item>
            <Form.Item label="子域名 (subdomain)" help="仅当 frps 配置了 subDomainHost 时使用，可留空">
              <Input value={p.subdomain ?? ""} onChange={(e) => set({ subdomain: e.target.value || null })} />
            </Form.Item>
          </>
        )}
        {f.remotePort && (
          <>
            <div className="section-title">访问地址</div>
            <Form.Item label="远程端口 (remotePort)" help="frps 服务器上对外开放的端口">
              <InputNumber min={1} max={65535} style={{ width: "100%" }} value={p.remotePort ?? undefined} onChange={(v) => set({ remotePort: v ?? null })} />
            </Form.Item>
          </>
        )}

        <div className="section-title">本地服务</div>
        {f.plugin && (
          <Form.Item label="插件" help={p.type === "https" && !hasPlugin ? "不使用插件时，本地服务需要自己提供 HTTPS 和证书" : undefined}>
            <Select value={plugin.type} onChange={changePlugin} options={PLUGIN_TYPES} popupMatchSelectWidth={false} />
          </Form.Item>
        )}

        {!hasPlugin && (
          <div className="row-2">
            <Form.Item label="本地 IP (localIP)">
              <Input className="mono" value={p.localIp ?? ""} placeholder="127.0.0.1" onChange={(e) => set({ localIp: e.target.value || null })} />
            </Form.Item>
            <Form.Item label="本地端口 (localPort)">
              <InputNumber min={1} max={65535} style={{ width: "100%" }} value={p.localPort ?? undefined} onChange={(v) => set({ localPort: v ?? null })} />
            </Form.Item>
          </div>
        )}

        {hasPlugin && pf.localAddr && (
          <Form.Item label="本地地址 (localAddr)" help="要穿透的本地 Web 服务，host:port">
            <LocalAddrInput value={plugin.localAddr ?? ""} onChange={onLocalAddr} />
          </Form.Item>
        )}
        {hasPlugin && pf.cert && (
          <CertPicker
            plugin={plugin}
            domains={p.customDomains}
            onChange={(crt, key) => setPlugin({ crtPath: crt, keyPath: key })}
          />
        )}
        {hasPlugin && pf.hostRewrite && (
          <Form.Item label="Host 头改写 (hostHeaderRewrite)" help="一般与本地地址的 IP 一致，避免本地服务因 Host 不匹配拒绝请求">
            <Input className="mono" value={plugin.hostHeaderRewrite ?? ""} onChange={(e) => setPlugin({ hostHeaderRewrite: e.target.value || null })} />
          </Form.Item>
        )}
        {hasPlugin && pf.headers && (
          <Form.Item label="附加请求头 (requestHeaders.set)">
            <HeadersEditor value={plugin.requestHeadersSet ?? {}} onChange={(v) => setPlugin({ requestHeadersSet: v })} />
          </Form.Item>
        )}
        {hasPlugin && pf.staticFile && (
          <div className="row-2">
            <Form.Item label="本地目录 (localPath)">
              <Input className="mono" value={plugin.localPath ?? ""} onChange={(e) => setPlugin({ localPath: e.target.value || null })} />
            </Form.Item>
            <Form.Item label="URL 前缀 (stripPrefix)">
              <Input value={plugin.stripPrefix ?? ""} onChange={(e) => setPlugin({ stripPrefix: e.target.value || null })} />
            </Form.Item>
          </div>
        )}
        {hasPlugin && pf.unixPath && (
          <Form.Item label="套接字路径 (unixPath)">
            <Input className="mono" value={plugin.unixPath ?? ""} placeholder="/var/run/docker.sock" onChange={(e) => setPlugin({ unixPath: e.target.value || null })} />
          </Form.Item>
        )}
        {hasPlugin && pf.httpAuth && (
          <div className="row-2">
            <Form.Item label="用户名 (httpUser)">
              <Input value={plugin.httpUser ?? ""} onChange={(e) => setPlugin({ httpUser: e.target.value || null })} />
            </Form.Item>
            <Form.Item label="密码 (httpPassword)">
              <Input.Password value={plugin.httpPassword ?? ""} onChange={(e) => setPlugin({ httpPassword: e.target.value || null })} />
            </Form.Item>
          </div>
        )}
        {hasPlugin && pf.socksAuth && (
          <div className="row-2">
            <Form.Item label="用户名 (username)">
              <Input value={plugin.username ?? ""} onChange={(e) => setPlugin({ username: e.target.value || null })} />
            </Form.Item>
            <Form.Item label="密码 (password)">
              <Input.Password value={plugin.password ?? ""} onChange={(e) => setPlugin({ password: e.target.value || null })} />
            </Form.Item>
          </div>
        )}

        <Collapse
          ghost
          size="small"
          style={{ marginTop: 8 }}
          items={[
            {
              key: "adv",
              label: "高级选项",
              children: (
                <>
                  {f.secret && (
                    <>
                      <Form.Item label="密钥 (secretKey)" help="访问端（visitor）需要相同密钥">
                        <Input.Password value={p.secretKey ?? ""} onChange={(e) => set({ secretKey: e.target.value || null })} />
                      </Form.Item>
                      <Form.Item label="允许的用户 (allowUsers)" help="填 * 表示所有用户">
                        <Select mode="tags" open={false} suffixIcon={null} value={p.allowUsers} onChange={(v) => set({ allowUsers: v })} />
                      </Form.Item>
                    </>
                  )}
                  {f.locations && (
                    <Form.Item label="路径路由 (locations)">
                      <Select mode="tags" open={false} suffixIcon={null} value={p.locations} onChange={(v) => set({ locations: v })} placeholder="/api" />
                    </Form.Item>
                  )}
                  {f.httpAuth && (
                    <div className="row-2">
                      <Form.Item label="访问用户名 (httpUser)">
                        <Input value={p.httpUser ?? ""} onChange={(e) => set({ httpUser: e.target.value || null })} />
                      </Form.Item>
                      <Form.Item label="访问密码 (httpPassword)">
                        <Input.Password value={p.httpPassword ?? ""} onChange={(e) => set({ httpPassword: e.target.value || null })} />
                      </Form.Item>
                    </div>
                  )}
                  {f.hostRewrite && (
                    <Form.Item label="Host 头改写 (hostHeaderRewrite)">
                      <Input value={p.hostHeaderRewrite ?? ""} onChange={(e) => set({ hostHeaderRewrite: e.target.value || null })} />
                    </Form.Item>
                  )}
                  {f.multiplexer && (
                    <div className="row-2">
                      <Form.Item label="复用器 (multiplexer)">
                        <Select value={p.multiplexer ?? "httpconnect"} onChange={(v) => set({ multiplexer: v })} options={[{ value: "httpconnect" }]} />
                      </Form.Item>
                      <Form.Item label="按用户路由 (routeByHTTPUser)">
                        <Input value={p.routeByHttpUser ?? ""} onChange={(e) => set({ routeByHttpUser: e.target.value || null })} />
                      </Form.Item>
                    </div>
                  )}
                  <div className="row-2">
                    <Form.Item label="加密传输 (useEncryption)">
                      <Switch checked={!!p.useEncryption} onChange={(v) => set({ useEncryption: v || null })} />
                    </Form.Item>
                    <Form.Item label="压缩传输 (useCompression)">
                      <Switch checked={!!p.useCompression} onChange={(v) => set({ useCompression: v || null })} />
                    </Form.Item>
                  </div>
                  <div className="row-2">
                    <Form.Item label="带宽限制 (bandwidthLimit)" help="如 1MB、512KB">
                      <Input value={p.bandwidthLimit ?? ""} onChange={(e) => set({ bandwidthLimit: e.target.value || null })} />
                    </Form.Item>
                    <Form.Item label="限速位置 (bandwidthLimitMode)">
                      <Select
                        allowClear
                        value={p.bandwidthLimitMode ?? undefined}
                        onChange={(v) => set({ bandwidthLimitMode: v ?? null })}
                        options={[
                          { value: "client", label: "client（frpc 端）" },
                          { value: "server", label: "server（frps 端）" },
                        ]}
                      />
                    </Form.Item>
                  </div>
                  <div className="faint">其它未在此列出的字段（如 healthCheck、metadatas）会原样保留，可在「源码」中编辑。</div>
                </>
              ),
            },
          ]}
        />
        <button type="submit" hidden />
      </Form>
    </Drawer>
  );
}
