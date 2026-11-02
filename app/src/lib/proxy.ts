import type { CertFile, PluginForm, ProxyForm, Settings } from "../api/types";

export const PROXY_TYPES = [
  { value: "https", label: "HTTPS", desc: "HTTPS 虚拟主机，可配合 https2http 加载自己的证书" },
  { value: "http", label: "HTTP", desc: "HTTP 虚拟主机 / 路径路由" },
  { value: "tcp", label: "TCP", desc: "透传 TCP 端口" },
  { value: "udp", label: "UDP", desc: "透传 UDP 端口" },
  { value: "tcpmux", label: "TCPMUX", desc: "按域名复用 TCP" },
  { value: "stcp", label: "STCP", desc: "点对点加密 TCP（需访问端）" },
  { value: "sudp", label: "SUDP", desc: "点对点加密 UDP（需访问端）" },
  { value: "xtcp", label: "XTCP", desc: "P2P 打洞 TCP（需访问端）" },
] as const;

export const PLUGIN_TYPES = [
  { value: "none", label: "不使用插件（直接转发本地端口）" },
  { value: "https2http", label: "https2http · 用自己的证书提供 HTTPS，转发到本地 HTTP" },
  { value: "https2https", label: "https2https · 用自己的证书提供 HTTPS，转发到本地 HTTPS" },
  { value: "http2https", label: "http2https · HTTP 入，转发到本地 HTTPS" },
  { value: "static_file", label: "static_file · 静态文件服务" },
  { value: "http_proxy", label: "http_proxy · HTTP 代理" },
  { value: "socks5", label: "socks5 · SOCKS5 代理" },
  { value: "unix_domain_socket", label: "unix_domain_socket · Unix 套接字" },
];

export const TYPE_COLORS: Record<string, string> = {
  https: "green",
  http: "blue",
  tcp: "orange",
  udp: "gold",
  tcpmux: "geekblue",
  stcp: "purple",
  sudp: "cyan",
  xtcp: "magenta",
};

export function featuresOf(type: string) {
  const t = type || "tcp";
  return {
    vhost: ["http", "https", "tcpmux"].includes(t),
    remotePort: ["tcp", "udp"].includes(t),
    locations: t === "http",
    httpAuth: ["http", "tcpmux"].includes(t),
    hostRewrite: t === "http",
    multiplexer: t === "tcpmux",
    secret: ["stcp", "sudp", "xtcp"].includes(t),
    plugin: ["http", "https", "tcp", "tcpmux", "stcp", "xtcp"].includes(t),
  };
}

export function pluginFeaturesOf(type: string | undefined) {
  const t = type ?? "none";
  return {
    localAddr: ["https2http", "https2https", "http2https"].includes(t),
    cert: ["https2http", "https2https"].includes(t),
    hostRewrite: ["https2http", "https2https", "http2https"].includes(t),
    headers: ["https2http", "https2https", "http2https"].includes(t),
    unixPath: t === "unix_domain_socket",
    staticFile: t === "static_file",
    httpAuth: ["http_proxy", "static_file"].includes(t),
    socksAuth: t === "socks5",
  };
}

export function emptyPlugin(type: string): PluginForm {
  return { type, requestHeadersSet: {} };
}

/** The common case: https + https2http with an own certificate. */
export function newHttpsSite(cert?: CertFile): ProxyForm {
  return {
    origin: null,
    enabled: true,
    name: "",
    type: "https",
    customDomains: [],
    locations: [],
    allowUsers: [],
    plugin: {
      type: "https2http",
      localAddr: "127.0.0.1:8080",
      crtPath: cert?.configPath ?? null,
      keyPath: cert?.pair ? `./certs/${cert.pair}` : null,
      hostHeaderRewrite: "127.0.0.1",
      requestHeadersSet: { "x-from-where": "frp" },
    },
  };
}

export function newTcpProxy(): ProxyForm {
  return {
    origin: null,
    enabled: true,
    name: "",
    type: "tcp",
    localIp: "127.0.0.1",
    localPort: 22,
    remotePort: 6000,
    customDomains: [],
    locations: [],
    allowUsers: [],
  };
}

/** Public URLs a visitor uses to reach this proxy. */
export function accessUrls(p: ProxyForm, s: Settings | null, serverAddr: string): string[] {
  const httpsPort = s?.httpsPort ?? 443;
  const httpPort = s?.httpPort ?? 80;
  if (p.type === "https") {
    const sfx = httpsPort === 443 ? "" : `:${httpsPort}`;
    return p.customDomains.map((d) => `https://${d}${sfx}`);
  }
  if (p.type === "http") {
    const sfx = httpPort === 80 ? "" : `:${httpPort}`;
    const loc = p.locations[0] && p.locations[0] !== "/" ? p.locations[0] : "";
    return p.customDomains.map((d) => `http://${d}${sfx}${loc}`);
  }
  if ((p.type === "tcp" || p.type === "udp") && p.remotePort) {
    return [`${p.type}://${serverAddr}:${p.remotePort}`];
  }
  return [];
}

/** Where the traffic ends up locally. */
export function localTarget(p: ProxyForm): string {
  const pl = p.plugin;
  if (pl && pl.type !== "none") {
    if (pl.localAddr) {
      const scheme = pl.type === "https2https" || pl.type === "http2https" ? "https" : "http";
      return `${scheme}://${pl.localAddr}`;
    }
    if (pl.localPath) return pl.localPath;
    if (pl.unixPath) return pl.unixPath;
    return pl.type;
  }
  if (p.localPort) return `${p.localIp || "127.0.0.1"}:${p.localPort}`;
  return "—";
}

/** Find a library cert (with key) that covers all given domains. */
export function suggestCert(certs: CertFile[], domains: string[]): CertFile | undefined {
  if (!domains.length) return undefined;
  return certs
    .filter((c) => c.kind === "cert" && c.cert && c.pair && c.cert.daysLeft >= 0)
    .filter((c) => domains.every((d) => c.cert!.dnsNames.some((n) => nameMatches(n, d))))
    .sort((a, b) => b.cert!.daysLeft - a.cert!.daysLeft)[0];
}

export function nameMatches(pattern: string, host: string): boolean {
  const p = pattern.toLowerCase().replace(/\.$/, "");
  const h = host.toLowerCase().trim().replace(/\.$/, "");
  if (p.startsWith("*.")) {
    const i = h.indexOf(".");
    return i > 0 && h.slice(i + 1) === p.slice(2);
  }
  return p === h;
}

/** Remove fields irrelevant for the chosen proxy type before saving. */
export function normalizeProxy(p: ProxyForm): ProxyForm {
  const f = featuresOf(p.type);
  const out: ProxyForm = { ...p, name: p.name.trim() };
  if (!f.vhost) {
    out.customDomains = [];
    out.subdomain = null;
  }
  if (!f.remotePort) out.remotePort = null;
  if (!f.locations) out.locations = [];
  if (!f.httpAuth) {
    out.httpUser = null;
    out.httpPassword = null;
  }
  if (!f.hostRewrite) out.hostHeaderRewrite = null;
  if (!f.multiplexer) {
    out.multiplexer = null;
    out.routeByHttpUser = null;
  }
  if (!f.secret) {
    out.secretKey = null;
    out.allowUsers = [];
  }
  if (!f.plugin || !out.plugin || out.plugin.type === "none") out.plugin = null;
  if (out.plugin) {
    // With a plugin frpc ignores localIP / localPort.
    out.localIp = null;
    out.localPort = null;
  }
  return out;
}
