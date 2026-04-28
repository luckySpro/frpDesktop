import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Col, Row, Space, Tag, Typography, message, Badge, Tooltip } from "antd";
import {
  PlayCircleFilled,
  PauseCircleFilled,
  ReloadOutlined,
  ClearOutlined,
  CloudServerOutlined,
  BranchesOutlined,
  FieldTimeOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../store/app";
import { api, LogLine, RunnerStatus } from "../api/tauri";

function StatusBadge({ s }: { s: RunnerStatus }) {
  const wrap = (color: string, label: string, extra?: string) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "100%",
      }}
    >
      <Badge status={color as any} style={{ flexShrink: 0 }} />
      <span style={{ color: colorMap[color], fontWeight: 600 }}>{label}</span>
      {extra && (
        <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 12 }}>
          {extra}
        </span>
      )}
    </span>
  );
  switch (s.status) {
    case "running":
      return wrap("processing", "运行中", `PID ${s.pid}`);
    case "starting":
      return wrap("processing", "启动中");
    case "exited":
      return wrap("error", "已退出", `code ${String(s.code)}`);
    default:
      return wrap("default", "已停止");
  }
}

const colorMap: Record<string, string> = {
  processing: "#ea580c",
  error: "#dc2626",
  default: "#78716c",
};

function InfoCard({
  icon,
  label,
  value,
  accent,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent: string;
  tooltip?: string;
}) {
  const inner = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)`,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          flexShrink: 0,
          boxShadow: `0 6px 14px ${accent}55`,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: "#92754d", fontSize: 12, lineHeight: 1.4, fontWeight: 500 }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 14,
            marginTop: 4,
            fontWeight: 600,
            color: "#1c1917",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
  return (
    <Card
      variant="borderless"
      style={{
        borderRadius: 14,
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(6px)",
        boxShadow: "0 4px 14px rgba(234, 88, 12, 0.08)",
        border: "1px solid rgba(255,237,213,0.9)",
        height: "100%",
      }}
      styles={{ body: { padding: 14 } }}
    >
      {tooltip ? <Tooltip title={tooltip}>{inner}</Tooltip> : inner}
    </Card>
  );
}

function formatElapsed(iso?: string) {
  if (!iso) return "--";
  const since = new Date(iso).getTime();
  const sec = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

export default function Dashboard() {
  const status = useAppStore((s) => s.status);
  const logs = useAppStore((s) => s.logs);
  const version = useAppStore((s) => s.version);
  const clearLogs = useAppStore((s) => s.clearLogs);
  const paths = useAppStore((s) => s.paths);

  const logEl = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);

  // Refresh "elapsed" clock locally; no need to poll backend.
  useEffect(() => {
    if (status.status !== "running") return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [status.status]);

  useEffect(() => {
    if (logEl.current) {
      logEl.current.scrollTop = logEl.current.scrollHeight;
    }
  }, [logs.length]);

  const runningSince = useMemo(
    () => (status.status === "running" ? status.since : undefined),
    [status]
  );
  void tick;

  const proxyCount = useAppStore((s) => {
    void s;
    return null;
  });
  void proxyCount;

  const isRunning = status.status === "running";
  const isBusy = status.status === "starting";

  const start = async () => {
    try {
      await api.runnerStart();
    } catch (e) {
      message.error(String(e));
    }
  };
  const stop = async () => {
    try {
      await api.runnerStop();
    } catch (e) {
      message.error(String(e));
    }
  };
  const restart = async () => {
    try {
      if (isRunning) await api.runnerStop();
      await api.runnerStart();
    } catch (e) {
      message.error(String(e));
    }
  };

  const profileName = paths?.paths.default_profile
    ? paths.paths.default_profile.split("/").pop()
    : "--";

  return (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={24} sm={12} xl={6}>
          <InfoCard
            icon={<CloudServerOutlined />}
            label="运行状态"
            value={<StatusBadge s={status} />}
            accent="#f97316"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <InfoCard
            icon={<BranchesOutlined />}
            label="frpc 版本"
            value={version ?? "未安装"}
            accent="#ec4899"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <InfoCard
            icon={<FieldTimeOutlined />}
            label="运行时长"
            value={formatElapsed(runningSince)}
            accent="#14b8a6"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <InfoCard
            icon={<FileTextOutlined />}
            label="配置文件"
            value={profileName ?? "--"}
            accent="#fbbf24"
            tooltip={paths?.paths.default_profile}
          />
        </Col>
      </Row>

      <Card
        style={{
          borderRadius: 14,
          marginBottom: 14,
          background:
            "linear-gradient(135deg,#ffffff 0%,#fff7ed 100%)",
          border: "1px solid rgba(255,237,213,0.9)",
          boxShadow: "0 4px 14px rgba(234, 88, 12, 0.08)",
        }}
        styles={{ body: { padding: 16 } }}
        variant="borderless"
      >
        <Space size={10} wrap>
          <Button
            type="primary"
            size="middle"
            icon={<PlayCircleFilled />}
            loading={isBusy}
            disabled={isRunning || isBusy}
            onClick={start}
          >
            启动
          </Button>
          <Button
            danger
            size="middle"
            icon={<PauseCircleFilled />}
            disabled={!isRunning}
            onClick={stop}
          >
            停止
          </Button>
          <Button
            size="middle"
            icon={<ReloadOutlined />}
            onClick={restart}
          >
            重启
          </Button>
          <Button size="middle" icon={<ClearOutlined />} onClick={clearLogs}>
            清空日志
          </Button>
        </Space>
      </Card>

      <Card
        title={
          <Space>
            <span style={{ fontWeight: 600, color: "#7c2d12" }}>实时日志</span>
            <Tag color="orange">{logs.length} 行</Tag>
          </Space>
        }
        style={{
          borderRadius: 14,
          border: "1px solid rgba(255,237,213,0.9)",
          boxShadow: "0 4px 14px rgba(234, 88, 12, 0.08)",
        }}
        styles={{ body: { padding: 0 } }}
        variant="borderless"
      >
        <div ref={logEl} className="log-panel">
          {logs.length === 0 ? (
            <Typography.Text type="secondary" style={{ color: "#64748b" }}>
              暂无日志。启动后会实时显示 frpc 输出。
            </Typography.Text>
          ) : (
            logs.map((l: LogLine, i: number) => (
              <div key={i} className={"line line-" + l.stream}>
                {l.line}
              </div>
            ))
          )}
        </div>
      </Card>
    </>
  );
}
