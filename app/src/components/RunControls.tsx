import { App, Button, Space, Tooltip } from "antd";
import { CaretRightOutlined, PauseOutlined, ReloadOutlined } from "@ant-design/icons";
import { useState } from "react";
import { api, errText } from "../api/tauri";
import type { RunnerStatus } from "../api/types";
import { isActive, useApp } from "../store/app";

export function statusText(s: RunnerStatus): { label: string; dot: string; sub?: string } {
  switch (s.status) {
    case "running":
      return { label: "运行中", dot: "ok", sub: `PID ${s.pid}${s.restarts ? ` · 已自动重启 ${s.restarts} 次` : ""}` };
    case "starting":
      return { label: "启动中", dot: "busy" };
    case "restarting":
      return { label: "等待重启", dot: "busy", sub: `${s.delay_secs}s 后第 ${s.attempt} 次重启` };
    case "exited":
      return { label: "已退出", dot: "err", sub: `退出码 ${s.code ?? "signal"}` };
    default:
      return { label: "已停止", dot: "" };
  }
}

export function StatusPill() {
  const status = useApp((s) => s.status);
  const daemon = useApp((s) => s.daemon);
  if (daemon?.loaded && !isActive(status)) {
    return (
      <span className="status-pill">
        <span className="dot ok" /> 后台服务运行中
      </span>
    );
  }
  const t = statusText(status);
  return (
    <span className="status-pill" title={t.sub}>
      <span className={`dot ${t.dot}`} />
      {t.label}
    </span>
  );
}

export default function RunControls({ size = "middle" }: { size?: "small" | "middle" }) {
  const { message } = App.useApp();
  const status = useApp((s) => s.status);
  const daemon = useApp((s) => s.daemon);
  const info = useApp((s) => s.info);
  const [busy, setBusy] = useState(false);
  const active = isActive(status);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      message.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (daemon?.loaded) {
    return (
      <Tooltip title="frpc 由系统后台服务管理，可在「设置」中关闭">
        <Button size={size} icon={<ReloadOutlined />} loading={busy} onClick={() => run(api.daemonRestart)}>
          重启服务
        </Button>
      </Tooltip>
    );
  }

  return (
    <Space size={8}>
      {active ? (
        <Button size={size} danger icon={<PauseOutlined />} loading={busy} onClick={() => run(api.runnerStop)}>
          停止
        </Button>
      ) : (
        <Button
          size={size}
          type="primary"
          icon={<CaretRightOutlined />}
          loading={busy}
          disabled={!info?.frpcPath}
          onClick={() => run(api.runnerStart)}
        >
          启动
        </Button>
      )}
      <Button size={size} icon={<ReloadOutlined />} disabled={!info?.frpcPath} loading={busy} onClick={() => run(api.runnerRestart)}>
        重启
      </Button>
    </Space>
  );
}
