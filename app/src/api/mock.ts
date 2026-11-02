// In-memory demo backend used when the UI runs outside Tauri (browser
// preview, README screenshots). Data is fictional (example.com).
import type {
  AppInfo,
  CertFile,
  DaemonStatus,
  FrpcForm,
  LogLine,
  ProxyForm,
  RunnerStatus,
  Settings,
  ValidationReport,
  VersionEntry,
} from "./types";

type Handler = (payload: unknown) => void;
const listeners = new Map<string, Set<Handler>>();

function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((h) => h(payload));
}

export async function mockListen(event: string, handler: Handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(handler);
  return () => listeners.get(event)?.delete(handler);
}

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);

const https = (name: string, port: number, crt = "./certs/example.com.crt"): ProxyForm => ({
  origin: null,
  enabled: true,
  name,
  type: "https",
  customDomains: [name],
  locations: [],
  allowUsers: [],
  plugin: {
    type: "https2http",
    localAddr: `127.0.0.1:${port}`,
    crtPath: crt,
    keyPath: crt.replace(/\.crt$/, ".key"),
    hostHeaderRewrite: "127.0.0.1",
    requestHeadersSet: { "x-from-where": "frp" },
  },
});

let form: FrpcForm = {
  serverAddr: "frp.example.com",
  serverPort: 7000,
  auth: { token: "demo-token" },
  proxies: [
    https("app.example.com", 5173),
    https("api.example.com", 8080),
    { ...https("docs.example.com", 4000), enabled: false },
    https("grafana.example.com", 3000, "./certs/grafana.example.com.crt"),
    {
      origin: null,
      enabled: true,
      name: "ssh",
      type: "tcp",
      localIp: "127.0.0.1",
      localPort: 22,
      remotePort: 6022,
      customDomains: [],
      locations: [],
      allowUsers: [],
      useEncryption: true,
    },
  ],
};
form.proxies.forEach((p, i) => (p.origin = i));

function render(f: FrpcForm): string {
  const q = (s: string) => JSON.stringify(s);
  const lines = [
    `serverAddr = ${q(f.serverAddr)}`,
    `serverPort = ${f.serverPort}`,
    f.auth.token ? `auth.token = ${q(f.auth.token)}` : "",
    "",
  ];
  for (const p of f.proxies) {
    lines.push("[[proxies]]", `name = ${q(p.name)}`, `type = ${q(p.type)}`);
    if (p.enabled === false) lines.push("enabled = false");
    if (p.localIp) lines.push(`localIP = ${q(p.localIp)}`);
    if (p.localPort) lines.push(`localPort = ${p.localPort}`);
    if (p.remotePort) lines.push(`remotePort = ${p.remotePort}`);
    if (p.customDomains.length) lines.push(`customDomains = [${p.customDomains.map(q).join(", ")}]`);
    if (p.useEncryption) lines.push(`transport.useEncryption = true`);
    if (p.plugin) {
      const pl = p.plugin;
      lines.push("[proxies.plugin]", `type = ${q(pl.type)}`);
      if (pl.localAddr) lines.push(`localAddr = ${q(pl.localAddr)}`);
      if (pl.crtPath) lines.push(`crtPath = ${q(pl.crtPath)}`);
      if (pl.keyPath) lines.push(`keyPath = ${q(pl.keyPath)}`);
      if (pl.hostHeaderRewrite) lines.push(`hostHeaderRewrite = ${q(pl.hostHeaderRewrite)}`);
      for (const [k, v] of Object.entries(pl.requestHeadersSet ?? {})) lines.push(`requestHeaders.set.${k} = ${q(v)}`);
    }
    lines.push("");
  }
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

let text = render(form);

const certs: CertFile[] = [
  {
    fileName: "example.com.crt",
    configPath: "./certs/example.com.crt",
    absPath: "~/frpDesktop/certs/example.com.crt",
    kind: "cert",
    size: 3876,
    pair: "example.com.key",
    cert: {
      subjectCn: "*.example.com",
      issuer: "Let's Encrypt",
      dnsNames: ["*.example.com", "example.com"],
      notBefore: now - 28 * DAY,
      notAfter: now + 62 * DAY,
      daysLeft: 62,
      selfSigned: false,
      chainLen: 2,
    },
  },
  { fileName: "example.com.key", configPath: "./certs/example.com.key", absPath: "", kind: "key", size: 1704, pair: "example.com.crt" },
  {
    fileName: "grafana.example.com.crt",
    configPath: "./certs/grafana.example.com.crt",
    absPath: "",
    kind: "cert",
    size: 3712,
    pair: "grafana.example.com.key",
    cert: {
      subjectCn: "grafana.example.com",
      issuer: "ZeroSSL",
      dnsNames: ["grafana.example.com"],
      notBefore: now - 80 * DAY,
      notAfter: now + 9 * DAY,
      daysLeft: 9,
      selfSigned: false,
      chainLen: 2,
    },
  },
  { fileName: "grafana.example.com.key", configPath: "./certs/grafana.example.com.key", absPath: "", kind: "key", size: 1704, pair: "grafana.example.com.crt" },
];

let settings: Settings = {
  mirrorPrefix: "https://gh-proxy.com/",
  frpcVersion: "0.65.0",
  frpcCustomPath: null,
  autoRestart: true,
  startFrpcOnLaunch: true,
  httpsPort: 443,
  httpPort: 80,
  theme: "system",
};

const since = new Date(Date.now() - (3 * 3600 + 17 * 60) * 1000).toISOString();
let status: RunnerStatus = { status: "running", pid: 48213, since, restarts: 0 };
let daemon: DaemonStatus = { kind: "launchd", supported: true, installed: false, loaded: false, unitPath: "~/Library/LaunchAgents/com.ueware.frpdesktop.frpc.plist" };

const ts = (m: number) => {
  const d = new Date(Date.now() - m * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.412`;
};
const logs: string[] = [
  `[stdout] ${ts(197)} [I] [sub/root.go:142] start frpc service for config file [profiles/default.toml]`,
  `[stdout] ${ts(197)} [I] [client/service.go:295] try to connect to server...`,
  `[stdout] ${ts(197)} [I] [client/service.go:287] [8c2f1a3b9d0e4f21] login to server success, get run id [8c2f1a3b9d0e4f21]`,
  `[stdout] ${ts(197)} [I] [proxy/proxy_manager.go:173] [8c2f1a3b9d0e4f21] proxy added: [app.example.com api.example.com grafana.example.com ssh]`,
  `[stdout] ${ts(197)} [I] [client/control.go:168] [8c2f1a3b9d0e4f21] [app.example.com] start proxy success`,
  `[stdout] ${ts(197)} [I] [client/control.go:168] [8c2f1a3b9d0e4f21] [api.example.com] start proxy success`,
  `[stdout] ${ts(197)} [I] [client/control.go:168] [8c2f1a3b9d0e4f21] [grafana.example.com] start proxy success`,
  `[stdout] ${ts(197)} [W] [client/control.go:166] [8c2f1a3b9d0e4f21] [ssh] start error: port already used`,
];

function validate(f: FrpcForm): ValidationReport {
  const issues: ValidationReport["issues"] = [];
  if (!f.serverAddr) issues.push({ level: "error", message: "服务器地址 (serverAddr) 不能为空" });
  const names = new Set<string>();
  for (const p of f.proxies) {
    if (!p.name) issues.push({ level: "error", message: "存在未命名的代理" });
    else if (names.has(p.name)) issues.push({ level: "error", proxy: p.name, message: `代理名称重复: ${p.name}` });
    names.add(p.name);
    if (p.enabled === false) continue;
    if (p.plugin?.crtPath?.includes("grafana"))
      issues.push({ level: "warning", proxy: p.name, message: `证书 ${p.plugin.crtPath} 将在 9 天后过期` });
  }
  return { ok: !issues.some((i) => i.level === "error"), issues };
}

const versions: VersionEntry[] = ["0.65.0", "0.64.0", "0.63.0", "0.62.1", "0.61.2"].map((v, i) => ({
  tag: `v${v}`,
  version: v,
  prerelease: false,
  publishedAt: new Date(Date.now() - i * 40 * DAY * 1000).toISOString(),
  assetName: `frp_${v}_darwin_arm64.tar.gz`,
  assetUrl: `https://github.com/fatedier/frp/releases/download/v${v}/frp_${v}_darwin_arm64.tar.gz`,
  checksumsUrl: null,
  installed: i < 2,
}));

const info = (): AppInfo => ({
  paths: {
    dataDir: "~/Library/Application Support/com.ueware.frpdesktop",
    binDir: "~/Library/Application Support/com.ueware.frpdesktop/bin",
    currentLink: "",
    profilesDir: "~/Library/Application Support/com.ueware.frpdesktop/profiles",
    runtimeProfile: "~/Library/Application Support/com.ueware.frpdesktop/profiles/runtime.toml",
    defaultProfile: "~/Library/Application Support/com.ueware.frpdesktop/profiles/default.toml",
    certsDir: "~/Library/Application Support/com.ueware.frpdesktop/certs",
    logsDir: "~/Library/Application Support/com.ueware.frpdesktop/logs",
    logFile: "~/Library/Application Support/com.ueware.frpdesktop/logs/frpc.log",
    settingsFile: "~/Library/Application Support/com.ueware.frpdesktop/settings.json",
  },
  profileExists: true,
  frpcPath: "~/Library/Application Support/com.ueware.frpdesktop/bin/frpc-v0.65.0",
  frpcVersion: settings.frpcVersion,
  platform: "darwin_arm64",
  appVersion: "0.2.0",
});

const setStatus = (s: RunnerStatus) => {
  status = s;
  emit("frpc://status", s);
};
const log = (l: LogLine) => emit("frpc://log", l);

export async function mockInvoke(cmd: string, args: Record<string, any> = {}): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 60));
  switch (cmd) {
    case "app_info":
      return info();
    case "settings_get":
      return settings;
    case "settings_save":
      settings = args.settings;
      return settings;
    case "autostart_get":
      return true;
    case "autostart_set":
      return args.enabled;
    case "config_load":
      return { text, exists: true };
    case "config_parse":
      return structuredClone(form);
    case "config_render":
      form = structuredClone(args.form);
      return render(form);
    case "config_check":
      return validate(form);
    case "config_save": {
      const r = validate(form);
      if (r.ok || args.force) text = args.text;
      return r;
    }
    case "config_verify":
      return { ok: true, output: "frpc: the configuration file profiles/default.toml syntax is ok" };
    case "certs_list":
      return certs;
    case "certs_import":
      return [];
    case "certs_delete":
      return null;
    case "frpc_list_versions":
      return versions;
    case "frpc_installed":
      return versions.filter((v) => v.installed).map((v) => v.version);
    case "frpc_use":
      settings = { ...settings, frpcVersion: args.version };
      return settings;
    case "runner_status":
      return status;
    case "runner_start":
      setStatus({ status: "running", pid: 48213, since: new Date().toISOString(), restarts: 0 });
      log({ stream: "system", line: "[frpDesktop] frpc 已启动" });
      return status;
    case "runner_stop":
      setStatus({ status: "stopped" });
      log({ stream: "system", line: "[frpDesktop] frpc 已停止" });
      return status;
    case "runner_restart":
      setStatus({ status: "running", pid: 48377, since: new Date().toISOString(), restarts: 0 });
      return status;
    case "runner_tail_log":
      return logs;
    case "runner_clear_log":
      logs.length = 0;
      return null;
    case "daemon_status":
      return daemon;
    case "daemon_enable":
      daemon = { ...daemon, installed: true, loaded: true };
      return daemon;
    case "daemon_disable":
      daemon = { ...daemon, installed: false, loaded: false };
      return daemon;
    default:
      throw new Error(`演示模式不支持该操作: ${cmd}`);
  }
}
