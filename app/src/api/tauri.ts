// Typed wrappers around the Tauri commands. Outside Tauri (plain browser,
// screenshots) every call is served by the in-memory demo backend.
import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppInfo,
  CertFile,
  DaemonStatus,
  FrpcForm,
  ImportResult,
  InstallProgress,
  LoadedConfig,
  LogLine,
  RunnerStatus,
  Settings,
  ValidationReport,
  VerifyResult,
  VersionEntry,
} from "./types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Handler = (payload: unknown) => void;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  const { mockInvoke } = await import("./mock");
  return mockInvoke(cmd, args) as Promise<T>;
}

async function on<T>(event: string, handler: (p: T) => void): Promise<UnlistenFn> {
  if (isTauri) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<T>(event, (e) => handler(e.payload));
  }
  const { mockListen } = await import("./mock");
  return mockListen(event, handler as Handler);
}

/** Native file picker; returns selected absolute paths. */
export async function pickFiles(opts: {
  title: string;
  multiple?: boolean;
  extensions?: string[];
  directory?: boolean;
}): Promise<string[]> {
  if (!isTauri) return [];
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({
    title: opts.title,
    multiple: !!opts.multiple,
    directory: !!opts.directory,
    filters: opts.extensions ? [{ name: opts.title, extensions: opts.extensions }] : undefined,
  });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

export const api = {
  appInfo: () => call<AppInfo>("app_info"),
  revealPath: (path: string) => call<void>("reveal_path", { path }),
  openUrl: (url: string) => call<void>("open_url", { url }),

  settingsGet: () => call<Settings>("settings_get"),
  settingsSave: (settings: Settings) => call<Settings>("settings_save", { settings }),
  autostartGet: () => call<boolean>("autostart_get"),
  autostartSet: (enabled: boolean) => call<boolean>("autostart_set", { enabled }),

  configLoad: () => call<LoadedConfig>("config_load"),
  configParse: (text: string) => call<FrpcForm>("config_parse", { text }),
  configRender: (original: string, form: FrpcForm) => call<string>("config_render", { original, form }),
  configCheck: (text: string) => call<ValidationReport>("config_check", { text }),
  configSave: (text: string, force = false) => call<ValidationReport>("config_save", { text, force }),
  configVerify: (text: string) => call<VerifyResult>("config_verify", { text }),
  configImport: (file: string) => call<ImportResult>("config_import", { file }),

  certsList: () => call<CertFile[]>("certs_list"),
  certsImport: (files: string[]) => call<string[]>("certs_import", { files }),
  certsDelete: (fileName: string) => call<void>("certs_delete", { fileName }),

  frpcListVersions: () => call<VersionEntry[]>("frpc_list_versions"),
  frpcInstalled: () => call<string[]>("frpc_installed"),
  frpcInstall: (entry: VersionEntry) => call<Settings>("frpc_install", { entry }),
  frpcUse: (version: string) => call<Settings>("frpc_use", { version }),
  frpcUninstall: (version: string) => call<void>("frpc_uninstall", { version }),

  runnerStart: () => call<RunnerStatus>("runner_start"),
  runnerStop: () => call<RunnerStatus>("runner_stop"),
  runnerRestart: () => call<RunnerStatus>("runner_restart"),
  runnerStatus: () => call<RunnerStatus>("runner_status"),
  runnerTailLog: (lines = 500) => call<string[]>("runner_tail_log", { lines }),
  runnerClearLog: () => call<void>("runner_clear_log"),

  daemonStatus: () => call<DaemonStatus>("daemon_status"),
  daemonEnable: () => call<DaemonStatus>("daemon_enable"),
  daemonDisable: () => call<DaemonStatus>("daemon_disable"),
  daemonRestart: () => call<DaemonStatus>("daemon_restart"),
};

export const events = {
  onLog: (h: (l: LogLine) => void) => on<LogLine>("frpc://log", h),
  onStatus: (h: (s: RunnerStatus) => void) => on<RunnerStatus>("frpc://status", h),
  onInstallProgress: (h: (p: InstallProgress) => void) => on<InstallProgress>("frpc://install-progress", h),
};

export function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
