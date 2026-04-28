import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Input,
  List,
  message,
  Progress,
  Space,
  Switch,
  Tag,
  Typography,
  Row,
  Col,
  Alert,
  Empty,
  Form,
} from "antd";
import {
  DownloadOutlined,
  ReloadOutlined,
  FolderOpenOutlined,
  DatabaseOutlined,
  FileOutlined,
  FolderOutlined,
  SafetyCertificateOutlined,
  ProfileOutlined,
  ThunderboltOutlined,
  CheckCircleFilled,
  GlobalOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../store/app";
import { api, onInstallProgress, VersionEntry } from "../api/tauri";

const dirIconMap: Record<string, React.ReactNode> = {
  "应用数据目录": <DatabaseOutlined />,
  "frpc 目录": <FolderOutlined />,
  "配置文件": <ProfileOutlined />,
  "证书目录": <SafetyCertificateOutlined />,
  "日志文件": <FileOutlined />,
};

export default function Settings() {
  const paths = useAppStore((s) => s.paths);
  const launchd = useAppStore((s) => s.launchd);
  const refreshVersion = useAppStore((s) => s.refreshVersion);
  const refreshLaunchd = useAppStore((s) => s.refreshLaunchd);
  const version = useAppStore((s) => s.version);

  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [mirror, setMirror] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [installing, setInstalling] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  const refreshVersions = async () => {
    setLoadingList(true);
    try {
      const list = await api.frpcListVersions(mirror || undefined);
      setVersions(list);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    refreshVersions();
    const unlistenP = onInstallProgress((p) => {
      if (p.total > 0) {
        setProgress(Math.round((p.downloaded / p.total) * 100));
      }
    });
    return () => {
      unlistenP.then((u) => u());
    };
  }, []);

  const install = async (v: VersionEntry) => {
    const url = v.asset_url ?? (v as any).assetUrl;
    if (!url) {
      message.error("此版本未提供 macOS 对应架构资产");
      return;
    }
    setInstalling(v.version);
    setProgress(0);
    try {
      await api.frpcInstall(v.version, url, mirror || undefined);
      await refreshVersion();
      await refreshVersions();
      message.success(`已安装 frpc v${v.version}`);
    } catch (e) {
      message.error(String(e));
    } finally {
      setInstalling(null);
      setProgress(0);
    }
  };

  const toggleLaunchd = async (v: boolean) => {
    try {
      if (v) await api.launchdEnable();
      else await api.launchdDisable();
      await refreshLaunchd();
    } catch (e) {
      message.error(String(e));
    }
  };

  const cardStyle = {
    borderRadius: 14,
    boxShadow: "0 4px 14px rgba(234, 88, 12, 0.08)",
    border: "1px solid rgba(255,237,213,0.9)",
    marginBottom: 14,
  };
  const cardStyles = {
    header: {
      borderBottom: "1px solid #ffedd5",
      padding: "12px 16px",
      background:
        "linear-gradient(90deg,#ffffff 0%,#fff7ed 100%)",
    },
    body: { padding: 16 },
  };

  return (
    <Form layout="vertical" size="middle">
      <Card
        variant="borderless"
        title={
          <Space>
            <DownloadOutlined style={{ color: "#f97316" }} />
            <span style={{ color: "#7c2d12" }}>frpc 二进制管理</span>
            <Tag color={version ? "success" : "default"}>
              {version ? `当前 v${version}` : "未安装"}
            </Tag>
          </Space>
        }
        style={cardStyle}
        styles={cardStyles}
      >
        <Form.Item
          label="GitHub 镜像前缀（可选）"
          style={{ marginBottom: 12 }}
          help="国内网络可填入加速镜像，如 https://ghproxy.com/"
        >
          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder="https://ghproxy.com/"
              prefix={<GlobalOutlined style={{ color: "#94a3b8" }} />}
              value={mirror}
              onChange={(e) => setMirror(e.target.value)}
            />
            <Button
              icon={<ReloadOutlined />}
              loading={loadingList}
              onClick={refreshVersions}
              style={{ flex: "0 0 auto" }}
            >
              刷新版本列表
            </Button>
          </Space.Compact>
        </Form.Item>

        {installing && (
          <Alert
            type="info"
            showIcon
            message={`正在下载 frpc v${installing}...`}
            description={<Progress percent={progress} status="active" />}
            style={{ marginBottom: 12 }}
          />
        )}

        {versions.length === 0 && !loadingList ? (
          <Empty description="未获取到版本，点上面的刷新试试" />
        ) : (
          <List
            size="small"
            dataSource={versions}
            style={{
              borderRadius: 8,
              border: "1px solid #eef2f7",
              background: "#fff",
            }}
            renderItem={(v) => (
              <List.Item
                style={{ padding: "10px 14px" }}
                actions={[
                  <Button
                    key="install"
                    type={v.installed ? "default" : "primary"}
                    size="small"
                    icon={<DownloadOutlined />}
                    disabled={!!installing}
                    loading={installing === v.version}
                    onClick={() => install(v)}
                  >
                    {v.installed ? "重装" : "安装"}
                  </Button>,
                ]}
              >
                <Space>
                  <Tag
                    color={v.installed ? "green" : "blue"}
                    style={{ fontFamily: "ui-monospace, monospace" }}
                  >
                    {v.tag}
                  </Tag>
                  {v.installed && (
                    <CheckCircleFilled style={{ color: "#16a34a" }} />
                  )}
                  <span
                    style={{
                      color: "#64748b",
                      fontSize: 12,
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {v.asset_name ?? (v as any).assetName ?? "no asset"}
                  </span>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Card>

      <Card
        variant="borderless"
        title={
          <Space>
            <ThunderboltOutlined style={{ color: "#fbbf24" }} />
            <span style={{ color: "#7c2d12" }}>开机自启（launchd）</span>
          </Space>
        }
        style={cardStyle}
        styles={cardStyles}
      >
        <Row gutter={16} align="middle">
          <Col flex="none">
            <Switch
              checked={launchd?.loaded ?? false}
              onChange={toggleLaunchd}
            />
          </Col>
          <Col flex="auto">
            <div style={{ fontWeight: 600, color: "#0f172a" }}>
              {launchd?.loaded ? "已启用" : "未启用"}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              {launchd?.loaded
                ? "用户登录后自动拉起 frpc。应用内子进程会被停止以避免双实例。"
                : "启用后系统登录时会自动启动 frpc 守护进程。"}
            </div>
          </Col>
        </Row>
        {launchd?.plist_path && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              background: "#f8fafc",
              borderRadius: 6,
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              color: "#475569",
              wordBreak: "break-all",
            }}
          >
            {launchd.plist_path}
          </div>
        )}
      </Card>

      <Card
        variant="borderless"
        title={
          <Space>
            <FolderOpenOutlined style={{ color: "#14b8a6" }} />
            <span style={{ color: "#7c2d12" }}>数据目录</span>
          </Space>
        }
        style={cardStyle}
        styles={cardStyles}
      >
        {paths && (
          <List
            size="small"
            dataSource={[
              ["应用数据目录", paths.paths.data_dir],
              ["frpc 目录", paths.paths.bin_dir],
              ["配置文件", paths.paths.default_profile],
              ["证书目录", paths.paths.certs_dir],
              ["日志文件", paths.paths.log_file],
            ]}
            style={{
              borderRadius: 8,
              border: "1px solid #eef2f7",
              background: "#fff",
            }}
            renderItem={([label, p]) => (
              <List.Item
                style={{ padding: "10px 14px" }}
                actions={[
                  <Button
                    key="reveal"
                    size="small"
                    icon={<FolderOpenOutlined />}
                    onClick={() => api.revealInFinder(p)}
                  >
                    打开
                  </Button>,
                ]}
              >
                <Space align="start">
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      background:
                        "linear-gradient(135deg,#fb923c 0%,#fbbf24 100%)",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 15,
                      boxShadow: "0 4px 10px rgba(249,115,22,0.25)",
                    }}
                  >
                    {dirIconMap[label] ?? <FolderOutlined />}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>
                      {label}
                    </div>
                    <Typography.Text
                      type="secondary"
                      style={{
                        fontSize: 12,
                        fontFamily: "ui-monospace, monospace",
                        wordBreak: "break-all",
                      }}
                    >
                      {p}
                    </Typography.Text>
                  </div>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Card>
    </Form>
  );
}
