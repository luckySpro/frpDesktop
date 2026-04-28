import { useEffect, useState } from "react";
import { Layout, Menu, Modal, Button, Space, Typography } from "antd";
import {
  DashboardOutlined,
  SettingOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useAppStore } from "./store/app";
import { api } from "./api/tauri";
import Dashboard from "./pages/Dashboard";
import Config from "./pages/Config";
import Settings from "./pages/Settings";

const { Sider, Content, Header } = Layout;

type Tab = "dashboard" | "config" | "settings";

const titleMap: Record<Tab, string> = {
  dashboard: "状态面板",
  config: "配置管理",
  settings: "设置",
};

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const boot = useAppStore((s) => s.boot);
  const paths = useAppStore((s) => s.paths);
  const refreshPaths = useAppStore((s) => s.refreshPaths);
  const [migrateOpen, setMigrateOpen] = useState(false);

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    if (!paths) return;
    if (paths.profile_exists) return;
    setMigrateOpen(true);
  }, [paths?.profile_exists]);

  const runMigrate = async () => {
    try {
      await api.migrateFromPath("/Users/lucky/Documents/WorkSapce/frpDesktop");
      await refreshPaths();
      setMigrateOpen(false);
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <Layout style={{ height: "100vh" }}>
      <Sider
        width={220}
        theme="dark"
        style={{
          background:
            "linear-gradient(180deg,#1c1917 0%,#2a1a10 55%,#3b1d0c 100%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* soft glow */}
        <div
          style={{
            position: "absolute",
            top: -80,
            left: -60,
            width: 260,
            height: 260,
            background:
              "radial-gradient(circle, rgba(249,115,22,0.45) 0%, rgba(249,115,22,0) 70%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -120,
            right: -80,
            width: 280,
            height: 280,
            background:
              "radial-gradient(circle, rgba(251,191,36,0.22) 0%, rgba(251,191,36,0) 70%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "20px 18px 18px",
            color: "#fff",
            letterSpacing: 0.5,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "linear-gradient(135deg,#fb923c 0%,#f97316 55%,#fbbf24 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 800,
              fontSize: 18,
              boxShadow: "0 6px 16px rgba(249, 115, 22, 0.45)",
            }}
          >
            f
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>frpDesktop</div>
            <div style={{ fontSize: 11, color: "#fcd9b6" }}>frpc 管家</div>
          </div>
        </div>
        <Menu
          mode="inline"
          theme="dark"
          selectedKeys={[tab]}
          style={{ background: "transparent", borderRight: 0, fontSize: 14, position: "relative" }}
          onClick={({ key }) => setTab(key as Tab)}
          items={[
            {
              key: "dashboard",
              icon: <DashboardOutlined />,
              label: "状态面板",
            },
            {
              key: "config",
              icon: <FileTextOutlined />,
              label: "配置管理",
            },
            {
              key: "settings",
              icon: <SettingOutlined />,
              label: "设置",
            },
          ]}
        />
        <div style={{ flex: 1 }} />
        <div
          style={{
            position: "absolute",
            bottom: 14,
            left: 0,
            right: 0,
            padding: "0 18px",
            color: "#fcd9b6",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <ThunderboltOutlined style={{ color: "#fbbf24" }} />
          Tauri 2 · React
        </div>
      </Sider>
      <Layout
        style={{
          background:
            "linear-gradient(180deg,#fff8f1 0%,#fff2e4 100%)",
        }}
      >
        <Header
          style={{
            background: "#ffffff",
            borderBottom: "1px solid #ffedd5",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            height: 56,
            boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
          }}
        >
          <Typography.Title level={5} style={{ margin: 0, color: "#7c2d12" }}>
            {titleMap[tab]}
          </Typography.Title>
        </Header>
        <Content style={{ padding: 20, overflow: "auto" }}>
          {tab === "dashboard" && <Dashboard />}
          {tab === "config" && <Config />}
          {tab === "settings" && <Settings />}
        </Content>
      </Layout>

      <Modal
        title="导入现有 frpc 配置"
        open={migrateOpen}
        onCancel={() => setMigrateOpen(false)}
        footer={null}
      >
        <p>
          检测到你的工作区 <code>/Users/lucky/Documents/WorkSapce/frpDesktop</code>
          下存在 <code>frpc.toml</code>，是否一键导入到应用数据目录？
        </p>
        <p>
          证书文件会一并复制到 <code>certs/</code> 并重写为相对路径。
        </p>
        <Space>
          <Button type="primary" onClick={runMigrate}>
            导入
          </Button>
          <Button onClick={() => setMigrateOpen(false)}>稍后</Button>
        </Space>
      </Modal>
    </Layout>
  );
}
