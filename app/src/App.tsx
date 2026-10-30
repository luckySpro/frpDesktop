import { useEffect, useState } from "react";
import { Alert, Badge, Button } from "antd";
import {
  AppstoreOutlined,
  ClusterOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useApp } from "./store/app";
import { useConfig } from "./store/config";
import { isTauri } from "./api/tauri";
import Overview from "./pages/Overview";
import Proxies from "./pages/Proxies";
import Certificates from "./pages/Certificates";
import Settings from "./pages/Settings";
import RunControls, { StatusPill } from "./components/RunControls";

export type Tab = "overview" | "proxies" | "certs" | "settings";

const NAV: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "概览", icon: <AppstoreOutlined /> },
  { key: "proxies", label: "代理配置", icon: <ClusterOutlined /> },
  { key: "certs", label: "证书库", icon: <SafetyCertificateOutlined /> },
  { key: "settings", label: "设置", icon: <SettingOutlined /> },
];

function initialTab(): Tab {
  const t = new URLSearchParams(location.search).get("tab");
  return NAV.some((n) => n.key === t) ? (t as Tab) : "overview";
}

export default function App() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const boot = useApp((s) => s.boot);
  const info = useApp((s) => s.info);
  const certs = useApp((s) => s.certs);
  const loadConfig = useConfig((s) => s.load);
  const dirty = useConfig((s) => s.dirty);

  useEffect(() => {
    boot();
    loadConfig();
  }, [boot, loadConfig]);

  const expiring = certs.filter((c) => c.cert && c.cert.daysLeft <= 15).length;

  return (
    <div className="shell">
      <nav className="sider" aria-label="主导航">
        <div className="brand">
          <div className="brand-mark">f</div>
          <div className="brand-text">
            <div className="brand-name">frpDesktop</div>
            <div className="brand-sub">frpc 桌面管家</div>
          </div>
        </div>
        {NAV.map((n) => (
          <button
            key={n.key}
            className={"nav-item" + (tab === n.key ? " active" : "")}
            onClick={() => setTab(n.key)}
            aria-current={tab === n.key ? "page" : undefined}
          >
            {n.icon}
            <span>{n.label}</span>
            {n.key === "proxies" && dirty && <Badge className="badge" status="warning" />}
            {n.key === "certs" && expiring > 0 && <Badge className="badge" count={expiring} size="small" />}
          </button>
        ))}
        <div className="sider-foot">
          v{info?.appVersion ?? "—"}
          {!isTauri && " · 演示模式"}
        </div>
      </nav>

      <main className="main">
        <header className="topbar">
          <h1>{NAV.find((n) => n.key === tab)?.label}</h1>
          <StatusPill />
          <div className="spacer" />
          <RunControls />
        </header>
        <div className="content">
          {info && !info.frpcPath && tab !== "settings" && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 14 }}
              message="还没有可用的 frpc"
              description="在「设置」里一键下载官方 frpc（可走国内镜像），或指定已有的 frpc 程序路径。"
              action={
                <Button size="small" type="primary" onClick={() => setTab("settings")}>
                  去设置
                </Button>
              }
            />
          )}
          {tab === "overview" && <Overview onNavigate={setTab} />}
          {tab === "proxies" && <Proxies />}
          {tab === "certs" && <Certificates />}
          {tab === "settings" && <Settings />}
        </div>
      </main>
    </div>
  );
}
