// Types mirrored from the Rust backend (camelCase via serde).

export interface AppPaths {
  dataDir: string;
  binDir: string;
  currentLink: string;
  profilesDir: string;
  defaultProfile: string;
  runtimeProfile: string;
  certsDir: string;
  logsDir: string;
  logFile: string;
  settingsFile: string;
}

export interface AppInfo {
  paths: AppPaths;
  profileExists: boolean;
  frpcPath: string | null;
  frpcVersion: string | null;
  platform: string;
  appVersion: string;
}

export interface Settings {
  mirrorPrefix: string;
  frpcVersion: string | null;
  frpcCustomPath: string | null;
  autoRestart: boolean;
  startFrpcOnLaunch: boolean;
  httpsPort: number;
  httpPort: number;
  theme: "system" | "light" | "dark";
}

export interface PluginForm {
  type: string;
  localAddr?: string | null;
  hostHeaderRewrite?: string | null;
  crtPath?: string | null;
  keyPath?: string | null;
  requestHeadersSet: Record<string, string>;
  unixPath?: string | null;
  localPath?: string | null;
  stripPrefix?: string | null;
  httpUser?: string | null;
  httpPassword?: string | null;
  username?: string | null;
  password?: string | null;
}

export interface ProxyForm {
  /** index in the parsed document; undefined for new proxies */
  origin?: number | null;
  /** false = switched off: kept in the profile, not run by frpc */
  enabled: boolean;
  name: string;
  type: string;
  localIp?: string | null;
  localPort?: number | null;
  remotePort?: number | null;
  customDomains: string[];
  subdomain?: string | null;
  locations: string[];
  httpUser?: string | null;
  httpPassword?: string | null;
  hostHeaderRewrite?: string | null;
  multiplexer?: string | null;
  routeByHttpUser?: string | null;
  secretKey?: string | null;
  allowUsers: string[];
  useEncryption?: boolean | null;
  useCompression?: boolean | null;
  bandwidthLimit?: string | null;
  bandwidthLimitMode?: string | null;
  plugin?: PluginForm | null;
}

export interface FrpcForm {
  serverAddr: string;
  serverPort: number;
  auth: { token?: string | null };
  user?: string | null;
  proxies: ProxyForm[];
}

export interface Issue {
  level: "error" | "warning";
  proxy?: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: Issue[];
}

export interface LoadedConfig {
  text: string;
  exists: boolean;
}

export interface VerifyResult {
  ok: boolean;
  output: string;
}

export interface ImportResult {
  text: string;
  notes: string[];
}

export interface CertInfo {
  subjectCn?: string | null;
  issuer: string;
  dnsNames: string[];
  notBefore: number;
  notAfter: number;
  daysLeft: number;
  selfSigned: boolean;
  chainLen: number;
}

export interface CertFile {
  fileName: string;
  configPath: string;
  absPath: string;
  kind: "cert" | "key" | "unknown";
  size: number;
  cert?: CertInfo;
  pair?: string;
  error?: string;
}

export interface VersionEntry {
  tag: string;
  version: string;
  prerelease: boolean;
  publishedAt?: string | null;
  assetName?: string | null;
  assetUrl?: string | null;
  checksumsUrl?: string | null;
  installed: boolean;
}

export type RunnerStatus =
  | { status: "stopped" }
  | { status: "starting" }
  | { status: "running"; pid: number; since: string; restarts: number }
  | { status: "restarting"; attempt: number; delay_secs: number; code: number | null }
  | { status: "exited"; code: number | null; at: string };

export interface DaemonStatus {
  kind: "launchd" | "systemd" | "unsupported";
  supported: boolean;
  installed: boolean;
  loaded: boolean;
  unitPath?: string | null;
  binary?: string | null;
}

export interface LogLine {
  stream: "stdout" | "stderr" | "system";
  line: string;
}

export interface InstallProgress {
  version: string;
  downloaded: number;
  total: number;
}
