import { useEffect, useMemo, useState } from "react";
import { App, Button, Dropdown, Empty, Input, InputNumber, Segmented, Space, Spin, Switch, Tag, Tooltip, Form } from "antd";
import {
  CheckCircleOutlined,
  CodeOutlined,
  DownOutlined,
  FormOutlined,
  ImportOutlined,
  LockOutlined,
  PlusOutlined,
  SaveOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ProxyForm } from "../api/types";
import { api, errText, isTauri, pickFiles } from "../api/tauri";
import { useConfig } from "../store/config";
import { isActive, useApp } from "../store/app";
import { localTarget, newHttpsSite, newTcpProxy, PROXY_TYPES, TYPE_COLORS } from "../lib/proxy";
import ProxyEditor from "../components/ProxyEditor";
import TomlEditor from "../components/TomlEditor";
import Issues from "../components/Issues";

type Editing = { index: number | null; proxy: ProxyForm } | null;

function ProxyCard({
  p,
  issues,
  onClick,
  onToggle,
  toggling,
}: {
  p: ProxyForm;
  issues: number;
  onClick: () => void;
  onToggle: (enabled: boolean) => void;
  toggling: boolean;
}) {
  const on = p.enabled !== false;
  const certs = useApp((s) => s.certs);
  const cert = p.plugin?.crtPath ? certs.find((c) => c.configPath === p.plugin!.crtPath) : undefined;
  return (
    <div
      className={`panel proxy-card${on ? "" : " off"}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
    >
      <div className="head">
        <Tag color={TYPE_COLORS[p.type]} bordered={false} style={{ margin: 0 }}>
          {p.type.toUpperCase()}
        </Tag>
        <span className="name" title={p.name}>
          {p.name || "(未命名)"}
        </span>
        {!on && <Tag bordered={false}>已关闭</Tag>}
        {on && issues > 0 && <Tag color="error">{issues} 个问题</Tag>}
        <Tooltip title={on ? "关闭这个代理（保留配置）" : "启用这个代理"}>
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Switch size="small" checked={on} loading={toggling} onChange={onToggle} aria-label={`${on ? "关闭" : "启用"}代理 ${p.name}`} />
          </span>
        </Tooltip>
      </div>
      <dl className="kv">
        {p.customDomains.length > 0 && (
          <>
            <dt>域名</dt>
            <dd className="mono">{p.customDomains.join(", ")}</dd>
          </>
        )}
        {p.remotePort != null && (
          <>
            <dt>远程端口</dt>
            <dd className="mono">{p.remotePort}</dd>
          </>
        )}
        <dt>本地</dt>
        <dd className="mono">{localTarget(p)}</dd>
        {p.plugin && (
          <>
            <dt>插件</dt>
            <dd>{p.plugin.type}</dd>
          </>
        )}
        {(p.plugin?.type === "https2http" || p.plugin?.type === "https2https") && (
          <>
            <dt>证书</dt>
            <dd>
              {cert?.cert ? (
                <span>
                  <LockOutlined /> {cert.fileName}{" "}
                  {cert.cert.daysLeft < 0 ? (
                    <Tag color="error">已过期</Tag>
                  ) : cert.cert.daysLeft <= 15 ? (
                    <Tag color="warning">{cert.cert.daysLeft} 天后过期</Tag>
                  ) : null}
                </span>
              ) : p.plugin.crtPath ? (
                <span className="mono">{p.plugin.crtPath}</span>
              ) : (
                <span style={{ color: "var(--warn)" }}>自签名（未配置证书）</span>
              )}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

export default function Proxies() {
  const { message, modal } = App.useApp();
  const cfg = useConfig();
  const status = useApp((s) => s.status);
  const certs = useApp((s) => s.certs);
  const info = useApp((s) => s.info);
  const [editing, setEditing] = useState<Editing>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const daemonLoaded = useApp((s) => !!s.daemon?.loaded);
  const dark = document.documentElement.dataset.theme === "dark";

  // Re-validate shortly after every edit.
  useEffect(() => {
    if (!cfg.loaded) return;
    const t = setTimeout(() => cfg.check(), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.form, cfg.source, certs]);

  const form = cfg.form;
  const issuesByProxy = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of cfg.report?.issues ?? []) if (i.proxy && i.level === "error") m.set(i.proxy, (m.get(i.proxy) ?? 0) + 1);
    return m;
  }, [cfg.report]);

  if (!cfg.loaded) return <Spin />;

  const running = isActive(status);
  const doSave = async (restart: boolean) => {
    setSaving(true);
    try {
      let r = await cfg.save(false);
      if (!r.ok) {
        const errs = r.issues.filter((i) => i.level === "error").length;
        const go = await modal.confirm({
          title: `配置中有 ${errs} 个错误`,
          content: "frpc 可能无法启动或部分代理无法工作。仍然保存吗？",
          okText: "仍然保存",
          cancelText: "返回修改",
        });
        if (!go) return;
        r = await cfg.save(true);
      }
      if (restart) {
        await api.runnerRestart();
        message.success("已保存并重启 frpc");
      } else {
        message.success(running ? "已保存，重启 frpc 后生效" : "已保存");
      }
      useApp.getState().refreshInfo();
    } catch (e) {
      message.error(errText(e));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Switch one proxy on/off. With no other unsaved edits this applies right
   * away (save, then restart frpc if it is running); otherwise it is just
   * another pending edit that goes out with the next save.
   */
  const toggleProxy = async (index: number, enabled: boolean) => {
    const p = form?.proxies[index];
    if (!p) return;
    const wasDirty = cfg.dirty;
    cfg.setProxyEnabled(index, enabled);
    const verb = enabled ? "启用" : "关闭";
    if (wasDirty) {
      message.info(`已${verb} ${p.name}，保存后生效`);
      return;
    }
    setToggling(index);
    try {
      const r = await cfg.save(false);
      if (!r.ok) {
        message.warning(`已${verb} ${p.name}，但配置中有错误，修正后再保存`);
        return;
      }
      if (running) {
        await api.runnerRestart();
        message.success(`已${verb} ${p.name}，frpc 已重启`);
      } else if (daemonLoaded) {
        await api.daemonRestart();
        message.success(`已${verb} ${p.name}，后台服务已重启`);
      } else {
        message.success(`已${verb} ${p.name}`);
      }
      useApp.getState().refreshInfo();
    } catch (e) {
      message.error(errText(e));
    } finally {
      setToggling(null);
    }
  };

  const verify = async () => {
    setVerifying(true);
    try {
      const r = await api.configVerify(await cfg.currentText());
      if (r.ok) message.success(r.output || "frpc 校验通过");
      else modal.error({ title: "frpc 校验未通过", content: <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{r.output}</pre>, width: 560 });
    } catch (e) {
      message.error(errText(e));
    } finally {
      setVerifying(false);
    }
  };

  const importToml = async () => {
    const [file] = await pickFiles({ title: "选择 frpc.toml", extensions: ["toml"] });
    if (!file) return;
    try {
      const r = await api.configImport(file);
      await cfg.replaceText(r.text);
      await useApp.getState().refreshCerts();
      modal.info({
        title: "已导入，请检查后保存",
        content: (
          <div>
            <p>引用的证书已复制到证书库，路径已改写为 ./certs/…。</p>
            {r.notes.length > 0 && (
              <ul>
                {r.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        ),
      });
    } catch (e) {
      message.error(errText(e));
    }
  };

  const switchMode = async (m: string) => {
    try {
      await cfg.setMode(m as "form" | "source");
    } catch (e) {
      message.error("TOML 有语法错误，修正后才能切回表单：" + errText(e));
    }
  };

  const otherNames = (index: number | null) =>
    (form?.proxies ?? []).filter((_, i) => i !== index).map((p) => p.name.trim());

  const visible = (form?.proxies ?? [])
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => typeFilter === "all" || p.type === typeFilter)
    .filter(({ p }) => {
      const n = q.trim().toLowerCase();
      return !n || p.name.toLowerCase().includes(n) || p.customDomains.some((d) => d.includes(n)) || localTarget(p).includes(n);
    });

  const firstCert = certs.find((c) => c.kind === "cert" && c.pair && c.cert && c.cert.daysLeft >= 0);
  const addMenu = PROXY_TYPES.filter((t) => t.value !== "https").map((t) => ({ key: t.value, label: `${t.label} · ${t.desc}` }));
  const errors = cfg.report?.issues.filter((i) => i.level === "error").length ?? 0;
  const enabledCount = form?.proxies.filter((p) => p.enabled !== false).length ?? 0;

  return (
    <>
      <section className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head" style={{ borderBottom: 0 }}>
          <Segmented
            value={cfg.mode}
            onChange={switchMode}
            options={[
              { value: "form", label: "表单", icon: <FormOutlined /> },
              { value: "source", label: "源码", icon: <CodeOutlined /> },
            ]}
          />
          {cfg.mode === "form" && (
            <Space.Compact>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ index: null, proxy: newHttpsSite(firstCert) })}>
                新建 HTTPS 站点
              </Button>
              <Dropdown
                menu={{
                  items: addMenu,
                  onClick: ({ key }) => {
                    const p = key === "tcp" ? newTcpProxy() : { ...newTcpProxy(), type: key, remotePort: null };
                    setEditing({ index: null, proxy: p });
                  },
                }}
              >
                <Button type="primary" icon={<DownOutlined />} aria-label="其他代理类型" />
              </Dropdown>
            </Space.Compact>
          )}
          <div className="spacer" />
          {isTauri && (
            <Button icon={<ImportOutlined />} onClick={importToml}>
              导入 frpc.toml
            </Button>
          )}
          <Tooltip title={info?.frpcPath ? "用 frpc 自带的 verify 命令检查配置" : "需要先安装 frpc"}>
            <Button icon={<CheckCircleOutlined />} loading={verifying} disabled={!info?.frpcPath} onClick={verify}>
              frpc 校验
            </Button>
          </Tooltip>
          <Space.Compact>
            <Button type={cfg.dirty ? "primary" : "default"} icon={<SaveOutlined />} loading={saving} onClick={() => doSave(false)}>
              保存{cfg.dirty ? " *" : ""}
            </Button>
            {running && (
              <Button type={cfg.dirty ? "primary" : "default"} loading={saving} onClick={() => doSave(true)}>
                保存并重启
              </Button>
            )}
          </Space.Compact>
        </div>
      </section>

      {cfg.parseError && (
        <section className="panel" style={{ marginBottom: 14, borderColor: "var(--err)" }}>
          <div className="panel-body" style={{ color: "var(--err)" }}>
            TOML 语法错误：<span className="mono">{cfg.parseError}</span>
          </div>
        </section>
      )}

      {cfg.report && cfg.report.issues.length > 0 && (
        <section className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head">
            <h2>配置检查</h2>
            {errors > 0 ? <Tag color="error">{errors} 个错误</Tag> : <Tag color="success">可以运行</Tag>}
          </div>
          <div className="panel-body">
            <Issues issues={cfg.report.issues} max={8} />
          </div>
        </section>
      )}

      {cfg.mode === "source" ? (
        <TomlEditor value={cfg.source} onChange={cfg.setSource} dark={dark} />
      ) : form ? (
        <>
          <section className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-head">
              <h2>frps 服务器</h2>
              {!cfg.exists && <Tag color="orange">尚未保存</Tag>}
            </div>
            <div className="panel-body">
              <Form layout="vertical" requiredMark={false} component="div">
                <div className="row-3">
                  <Form.Item label="服务器地址 (serverAddr)" style={{ marginBottom: 8 }}>
                    <Input className="mono" value={form.serverAddr} placeholder="frp.example.com" onChange={(e) => cfg.setForm({ ...form, serverAddr: e.target.value })} />
                  </Form.Item>
                  <Form.Item label="端口 (serverPort)" style={{ marginBottom: 8 }}>
                    <InputNumber min={1} max={65535} style={{ width: "100%" }} value={form.serverPort} onChange={(v) => cfg.setForm({ ...form, serverPort: v ?? 7000 })} />
                  </Form.Item>
                  <Form.Item label="令牌 (auth.token)" style={{ marginBottom: 8 }}>
                    <Input.Password value={form.auth.token ?? ""} onChange={(e) => cfg.setForm({ ...form, auth: { ...form.auth, token: e.target.value || null } })} />
                  </Form.Item>
                </div>
              </Form>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>代理</h2>
              <Tooltip title="已启用 / 全部">
                <Tag>
                  {enabledCount === form.proxies.length ? form.proxies.length : `${enabledCount} / ${form.proxies.length}`}
                </Tag>
              </Tooltip>
              <div className="spacer" />
              <Segmented
                size="small"
                value={typeFilter}
                onChange={(v) => setTypeFilter(v as string)}
                options={[
                  { value: "all", label: "全部" },
                  ...Array.from(new Set(form.proxies.map((p) => p.type))).map((t) => ({ value: t, label: t.toUpperCase() })),
                ]}
              />
              <Input size="small" allowClear prefix={<SearchOutlined />} placeholder="名称 / 域名 / 端口" style={{ width: 180 }} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="panel-body">
              {form.proxies.length === 0 ? (
                <Empty description="还没有代理">
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ index: null, proxy: newHttpsSite(firstCert) })}>
                    新建 HTTPS 站点
                  </Button>
                </Empty>
              ) : visible.length === 0 ? (
                <Empty description="没有匹配的代理" />
              ) : (
                <div className="proxy-grid">
                  {visible.map(({ p, i }) => (
                    <ProxyCard
                      key={i}
                      p={p}
                      issues={issuesByProxy.get(p.name) ?? 0}
                      toggling={toggling === i}
                      onToggle={(v) => toggleProxy(i, v)}
                      onClick={() => setEditing({ index: i, proxy: structuredClone(p) })}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}

      <ProxyEditor
        open={!!editing}
        initial={editing?.proxy ?? null}
        isNew={editing?.index === null}
        existingNames={otherNames(editing?.index ?? null)}
        onClose={() => setEditing(null)}
        onSubmit={(p) => {
          cfg.upsertProxy(editing!.index, p);
          setEditing(null);
        }}
        onDelete={
          editing && editing.index !== null
            ? () =>
                modal.confirm({
                  title: `删除代理 ${editing.proxy.name}？`,
                  content: "保存后生效。",
                  okButtonProps: { danger: true },
                  okText: "删除",
                  onOk: () => {
                    cfg.removeProxy(editing.index!);
                    setEditing(null);
                  },
                })
            : undefined
        }
      />
    </>
  );
}
