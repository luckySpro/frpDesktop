import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, Segmented, Tag, Tooltip } from "antd";
import { ClearOutlined, CopyOutlined, VerticalAlignBottomOutlined } from "@ant-design/icons";
import { useApp } from "../store/app";
import { levelOf } from "../lib/logs";

export default function LogPanel() {
  const { message } = App.useApp();
  const logs = useApp((s) => s.logs);
  const clearLogs = useApp((s) => s.clearLogs);
  const [filter, setFilter] = useState<"all" | "problems">("all");
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(true);
  const el = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return logs
      .map((l) => ({ ...l, lvl: l.stream === "system" ? "S" : levelOf(l.line) }))
      .filter((l) => filter === "all" || l.lvl === "E" || l.lvl === "W" || l.stream === "stderr")
      .filter((l) => !needle || l.line.toLowerCase().includes(needle));
  }, [logs, filter, q]);

  useEffect(() => {
    if (follow && el.current) el.current.scrollTop = el.current.scrollHeight;
  }, [rows.length, follow]);

  const copy = async () => {
    await navigator.clipboard.writeText(rows.map((r) => r.line).join("\n"));
    message.success("已复制日志");
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>运行日志</h2>
        <Tag>{logs.length} 行</Tag>
        <div className="spacer" />
        <Segmented
          size="small"
          value={filter}
          onChange={(v) => setFilter(v as "all" | "problems")}
          options={[
            { label: "全部", value: "all" },
            { label: "警告与错误", value: "problems" },
          ]}
        />
        <Input.Search size="small" allowClear placeholder="搜索" style={{ width: 160 }} onChange={(e) => setQ(e.target.value)} />
        <Tooltip title={follow ? "自动滚动：开" : "自动滚动：关"}>
          <Button
            size="small"
            type={follow ? "primary" : "default"}
            ghost={follow}
            icon={<VerticalAlignBottomOutlined />}
            onClick={() => setFollow(!follow)}
            aria-label="自动滚动"
          />
        </Tooltip>
        <Tooltip title="复制">
          <Button size="small" icon={<CopyOutlined />} onClick={copy} aria-label="复制日志" />
        </Tooltip>
        <Tooltip title="清空">
          <Button size="small" icon={<ClearOutlined />} onClick={clearLogs} aria-label="清空日志" />
        </Tooltip>
      </div>
      <div ref={el} className="log-panel" role="log">
        {rows.length === 0 ? (
          <span style={{ opacity: 0.6 }}>暂无日志。启动 frpc 后这里会实时显示输出。</span>
        ) : (
          rows.map((l, i) => (
            <div key={i} className={`l-${l.lvl}`}>
              {l.line}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
