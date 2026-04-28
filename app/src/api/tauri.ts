import { invoke } from "@tauri-apps/api/core";
import { listen, Event, UnlistenFn } from "@tauri-apps/api/event";

// ---- Types mirrored from Rust ----

export interface AppPaths {
  data_dir: string;
  bin_dir: string;
  current_link: string;
  profiles_dir: string;
  default_profile: string;
  certs_dir: string;
  logs_dir: string;
  log_file: string;
}
export interface PathsInfo {
  paths: AppPaths;
  profile_exists: boolean;
  frpc_installed: boolean;
}

export interface VersionEntry {
  tag: string;
  version: string;
  assetName?: string | null;
  assetUrl?: string | null;
  asset_name?: string | null;
  asset_url?: string | null;
  installed: boolean;
}

export interface PluginForm {
  type: string;
  localAddr?: string | null;
  crtPath?: string | null;
  keyPath?: string | null;
  hostHeaderRewrite?: string | null;
  requestHeadersSet?: Record<string, string>;
  extra?: Record<string, string>;
}

export interface ProxyForm {
  name: string;
  type: string;
  customDomains?: string[];
  localIp?: string | null;
  localPort?: number | null;
  remotePort?: number | null;
  subdomain?: string | null;
  plugin?: PluginForm | null;
}

export interface FrpcForm {
  serverAddr: string;
  serverPort: number;
  auth: { token?: string | null };
  proxies: ProxyForm[];
}

export type RunnerStatus =
  | { status: "stopped" }
  | { status: "starting" }
  | { status: "running"; pid: number; since: string }
  | { status: "exited"; code: number | null; at: string };

export interface LaunchdStatus {
  installed: boolean;
  loaded: boolean;
  plist_path: string;
}

export interface LogLine {
  stream: "stdout" | "stderr" | "system";
  line: string;
}

// ---- Commands ----

export const api = {
  pathsInfo: () => invoke<PathsInfo>("paths_info"),
  revealInFinder: (path: string) => invoke<void>("reveal_in_finder", { path }),

  migrateFromPath: (sourceDir: string) =>
    invoke<string>("migrate_from_path", { sourceDir }),

  configLoad: () => invoke<string>("config_load"),
  configSave: (tomlText: string) => invoke<void>("config_save", { tomlText }),
  configParseToForm: (tomlText: string) =>
    invoke<FrpcForm>("config_parse_to_form", { tomlText }),
  configFormToDoc: (form: FrpcForm) =>
    invoke<string>("config_form_to_doc", { form }),
  configValidate: (tomlText: string) =>
    invoke<void>("config_validate", { tomlText }),
  certPickAndImport: (srcPath: string) =>
    invoke<string>("cert_pick_and_import", { srcPath }),

  frpcListVersions: (mirror?: string) =>
    invoke<VersionEntry[]>("frpc_list_versions", { mirror }),
  frpcInstall: (version: string, url: string, mirror?: string) =>
    invoke<string>("frpc_install", { version, url, mirror }),
  frpcCurrentVersion: () => invoke<string | null>("frpc_current_version"),

  runnerStart: () => invoke<RunnerStatus>("runner_start"),
  runnerStop: () => invoke<RunnerStatus>("runner_stop"),
  runnerStatus: () => invoke<RunnerStatus>("runner_status"),
  runnerTailLog: (lines?: number) =>
    invoke<string[]>("runner_tail_log", { lines: lines ?? 500 }),

  launchdStatus: () => invoke<LaunchdStatus>("launchd_status"),
  launchdEnable: () => invoke<LaunchdStatus>("launchd_enable"),
  launchdDisable: () => invoke<LaunchdStatus>("launchd_disable"),
};

// ---- Events ----

export function onLog(handler: (l: LogLine) => void): Promise<UnlistenFn> {
  return listen<LogLine>("frpc://log", (e: Event<LogLine>) => handler(e.payload));
}

export function onStatus(
  handler: (s: RunnerStatus) => void
): Promise<UnlistenFn> {
  return listen<RunnerStatus>("frpc://status", (e: Event<RunnerStatus>) => handler(e.payload));
}

export function onInstallProgress(
  handler: (p: { version: string; downloaded: number; total: number }) => void
): Promise<UnlistenFn> {
  return listen<{ version: string; downloaded: number; total: number }>(
    "frpc://install-progress",
    (e: Event<{ version: string; downloaded: number; total: number }>) =>
      handler(e.payload)
  );
}
