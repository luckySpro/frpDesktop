import { Tag } from "antd";
import type { Issue } from "../api/types";

export default function Issues({ issues, max }: { issues: Issue[]; max?: number }) {
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  const shown = max ? sorted.slice(0, max) : sorted;
  return (
    <div className="issues">
      {shown.map((i, k) => (
        <div className="issue" key={k}>
          <Tag className="tag" color={i.level === "error" ? "error" : "warning"} bordered={false}>
            {i.level === "error" ? "错误" : "提示"}
          </Tag>
          <span>
            {i.proxy && <b>{i.proxy}：</b>}
            {i.message}
          </span>
        </div>
      ))}
      {max && sorted.length > max && <div className="faint">还有 {sorted.length - max} 条…</div>}
    </div>
  );
}
