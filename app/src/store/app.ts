import { create } from "zustand";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { api, events } from "../api/tauri";
import type { AppInfo, CertFile, DaemonStatus, LogLine, RunnerStatus, Settings } from "../api/types";
import { parsePersistedLine } from "../lib/logs";

interface AppStore {
  booted: boolean;
  info: AppInfo | null;
  settings: Settings | null;
  status: RunnerStatus;
  logs: LogLine[];
  daemon: DaemonStatus | null;
  certs: CertFile[];

  boot: () => Promise<void>;
  refreshInfo: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  refreshDaemon: () => Promise<void>;
  refreshCerts: () => Promise<void>;
  clearLogs: () => Promise<void>;
}

const MAX_LOGS = 3000;
let unlisten: UnlistenFn[] = [];

export const useApp = create<AppStore>((set, get) => ({
  booted: false,
  info: null,
  settings: null,
  status: { status: "stopped" },
  logs: [],
  daemon: null,
  certs: [],

  async boot() {
    if (get().booted) return;
    set({ booted: true });
    unlisten.forEach((u) => u());
    unlisten = await Promise.all([
      events.onLog((line) => {
        const logs = get().logs.concat(line);
        if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
        set({ logs });
      }),
      events.onStatus((status) => set({ status })),
    ]);
    try {
      const tail = await api.runnerTailLog(500);
      set({ logs: tail.map(parsePersistedLine) });
    } catch {
      /* no log yet */
    }
    await Promise.all([
      get().refreshInfo(),
      get().refreshSettings(),
      get().refreshDaemon(),
      get().refreshCerts(),
      api.runnerStatus().then((status) => set({ status })).catch(() => {}),
    ]);
  },

  async refreshInfo() {
    try {
      set({ info: await api.appInfo() });
    } catch (e) {
      console.error(e);
    }
  },

  async refreshSettings() {
    try {
      set({ settings: await api.settingsGet() });
    } catch (e) {
      console.error(e);
    }
  },

  async saveSettings(patch) {
    const cur = get().settings;
    if (!cur) return;
    const settings = await api.settingsSave({ ...cur, ...patch });
    set({ settings });
  },

  async refreshDaemon() {
    try {
      set({ daemon: await api.daemonStatus() });
    } catch {
      set({ daemon: null });
    }
  },

  async refreshCerts() {
    try {
      set({ certs: await api.certsList() });
    } catch (e) {
      console.error(e);
    }
  },

  async clearLogs() {
    await api.runnerClearLog().catch(() => {});
    set({ logs: [] });
  },
}));

export function isActive(s: RunnerStatus) {
  return s.status === "running" || s.status === "starting" || s.status === "restarting";
}
