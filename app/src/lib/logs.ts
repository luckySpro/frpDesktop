import type { LogLine } from "../api/types";

export type ProxyHealth = { state: "ok" | "error"; message?: string; at?: string };

export interface LogDigest {
  login: "ok" | "error" | "unknown";
  loginMessage?: string;
  proxies: Record<string, ProxyHealth>;
}

const TIME_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;

/**
 * Derive login / per-proxy state from frpc log lines. frpc writes
 * `[name] start proxy success` and `[name] start error: …` for each proxy.
 * Only lines after the most recent (re)start are considered.
 */
export function digestLogs(lines: LogLine[]): LogDigest {
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].line;
    if (l.includes("start frpc service") || l.includes("frpc 已停止") || l.includes("frpc 退出")) {
      start = i;
      break;
    }
  }
  const d: LogDigest = { login: "unknown", proxies: {} };
  for (const { line } of lines.slice(start)) {
    const body = line.replace(/^\[(stdout|stderr)\]\s*/, "");
    const at = TIME_RE.exec(body)?.[1];
    if (/login to (the )?server success/.test(body)) {
      d.login = "ok";
      d.loginMessage = undefined;
    } else if (/login to (the )?server fail|connect to server error|authorization failed|token in login doesn't match/i.test(body)) {
      d.login = "error";
      d.loginMessage = body.replace(/^.*?\] (?=[^[])/, "");
    }
    let m = /\[([^\]]+)\] start proxy success/.exec(body);
    if (m) {
      d.proxies[m[1]] = { state: "ok", at };
      continue;
    }
    m = /\[([^\]]+)\] start error: (.*)$/.exec(body);
    if (m) d.proxies[m[1]] = { state: "error", message: m[2], at };
  }
  return d;
}

export function parsePersistedLine(line: string): LogLine {
  if (line.startsWith("[stderr] ")) return { stream: "stderr", line: line.slice(9) };
  if (line.startsWith("[stdout] ")) return { stream: "stdout", line: line.slice(9) };
  return { stream: "stdout", line };
}

export function levelOf(line: string): "E" | "W" | "I" | "D" | "S" {
  if (line.startsWith("[frpDesktop]")) return "S";
  const m = / \[([EWID])\] /.exec(line);
  return (m?.[1] as "E" | "W" | "I" | "D") ?? "I";
}
