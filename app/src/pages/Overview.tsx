import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Tag, Tooltip } from "antd";
import { ExportOutlined, PlusOutlined } from "@ant-design/icons";
import { api, errText } from "../api/tauri";
import { useApp, isActive } from "../store/app";
import { useConfig } from "../store/config";
import { digestLogs } from "../lib/logs";
import { accessUrls, localTarget, TYPE_COLORS } from "../lib/proxy";
import LogPanel from "../components/LogPanel";
import { statusText } from "../components/RunControls";
import type { Tab } from "../App";

function elapsed(iso: string) {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} 天 ${h} 小时`;
  if (h) return `${h} 小时 ${m} 分`;
  return `${m} 分 ${sec % 60} 秒`;
}

export default function Overview({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const { message } = App.useApp();
  const status = useApp((s) => s.status);
  const info = useApp((s) => s.info);
  const logs = useApp((s) => s.logs);
  const certs = useApp((s) => s.certs);
  const settings = useApp((s) => s.settings);
  const daemon = useApp((s) => s.daemon);
  const form = useConfig((s) => s.form);
  const [, tick] = useState(0);

  useEffect(() => {
    if (status.status !== "running") return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [status.status]);

  const digest = useMemo(() => digestLogs(logs), [logs]);
  const certByPath = useMemo(() => new Map(certs.map((c) => [c.configPath, c])), [certs]);
  const proxies = form?.proxies ?? [];
  const running = isActive(status) || !!daemon?.loaded;
  const enabled = proxies.filter((p) => p.enabled !== false);
  const offCount = proxies.length - enabled.length;
  const okCount = enabled.filter((p) => digest.proxies[p.name]?.state === "ok").length;
  const errCount = enabled.filter((p) => digest.proxies[p.name]?.state === "error").length;
  const st = statusText(status);

  const open = (url: string) => api.openUrl(url).catch((e) => message.error(errText(e)));

  return (
    <>
      <div className="stats">
        <div className="panel stat">
          <div className="stat-label">frpc 状态</div>
          <div className="stat-value" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`dot ${daemon?.loaded ? "ok" : st.dot}`} />
            {daemon?.loaded && !isActive(status) ? "后台服务" : st.label}
          </div>
          <div className="stat-sub">
            {status.status === "running" ? `已运行 ${elapsed(status.since)}` : st.sub ?? "—"}
          </div>
        </div>
        <div className="panel stat">
          <div className="stat-label">服务器</div>
          <div className="stat-value mono" title={form?.serverAddr}>
            {form?.serverAddr || "未配置"}
          </div>
          <div className="stat-sub">
            {digest.login === "ok" && running ? "已登录" : digest.login === "error" ? "登录失败" : `端口 ${form?.serverPort ?? "—"}`}
          </div>
        </div>
        <div className="panel stat">
          <div className="stat-label">代理</div>
          <div className="stat-value">
            {enabled.length} 个
          </div>
          <div className="stat-sub">
            {running ? `${okCount} 个正常${errCount ? ` · ${errCount} 个失败` : ""}` : "frpc 未运行"}
            {offCount > 0 && ` · ${offCount} 个已关闭`}
          </div>
        </div>
        <div className="panel stat">
          <div className="stat-label">frpc 版本</div>
          <div className="stat-value mono">{info?.frpcVersion ? `v${info.frpcVersion}` : "未安装"}</div>
          <div className="stat-sub">{info?.platform ?? ""}</div>
        </div>
      </div>

      {digest.login === "error" && running && (
        <div className="panel" style={{ marginBottom: 14, borderColor: "var(--err)" }}>
          <div className="panel-body" style={{ color: "var(--err)" }}>
            连接 frps 失败：{digest.loginMessage}。请检查服务器地址、端口和 token。
          </div>
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>站点与代理</h2>
          <div className="spacer" />
          <Button size="small" icon={<PlusOutlined />} onClick={() => onNavigate("proxies")}>
            管理代理
          </Button>
        </div>
        {proxies.length === 0 ? (
          <Empty style={{ padding: 24 }} description="还没有代理。到「代理配置」新建一个 HTTPS 站点吧" />
        ) : (
          <div className="site-list">
            {proxies.map((p) => {
              const on = p.enabled !== false;
              const h = on ? digest.proxies[p.name] : undefined;
              const urls = accessUrls(p, settings, form?.serverAddr ?? "");
              const cert = p.plugin?.crtPath ? certByPath.get(p.plugin.crtPath) : undefined;
              const days = cert?.cert?.daysLeft;
              const dot = !running || !on ? "" : h?.state === "ok" ? "ok" : h?.state === "error" ? "err" : "busy";
              return (
                <div className={`site-row${on ? "" : " off"}`} key={p.name}>
                  <Tooltip title={!on ? "已关闭" : !running ? "frpc 未运行" : h?.state === "error" ? h.message : h?.state === "ok" ? "运行正常" : "等待 frpc 报告"}>
                    <span className={`dot ${dot}`} />
                  </Tooltip>
                  <div className="site-main">
                    <div className="site-title">
                      {urls[0] && (p.type === "https" || p.type === "http") ? (
                        <button className="link" onClick={() => open(urls[0])}>
                          {urls[0].replace(/^https?:\/\//, "")} <ExportOutlined style={{ fontSize: 11 }} />
                        </button>
                      ) : (
                        p.name
                      )}
                    </div>
                    <div className="site-sub">
                      <Tag color={TYPE_COLORS[p.type]} bordered={false} style={{ marginRight: 6 }}>
                        {p.type.toUpperCase()}
                      </Tag>
                      {p.plugin?.type && <span className="faint">{p.plugin.type} · </span>}
                      {h?.state === "error" && running ? (
                        <span style={{ color: "var(--err)" }}>{h.message}</span>
                      ) : (
                        <span className="faint">{urls.length > 1 ? `另有 ${urls.length - 1} 个域名` : p.name}</span>
                      )}
                    </div>
                  </div>
                  <div className="site-local site-sub mono">→ {localTarget(p)}</div>
                  <div>
                    {!on ? (
                      <Tag bordered={false}>已关闭</Tag>
                    ) : days !== undefined &&
                      (days < 0 ? (
                        <Tag color="error">证书已过期</Tag>
                      ) : days <= 15 ? (
                        <Tag color="warning">证书 {days} 天后过期</Tag>
                      ) : (
                        <Tag color="success" bordered={false}>
                          证书 {days} 天
                        </Tag>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div style={{ height: 14 }} />
      <LogPanel />
    </>
  );
}
