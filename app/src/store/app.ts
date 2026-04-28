import { create } from "zustand";
import { api, onLog, onStatus, RunnerStatus, LogLine, PathsInfo, LaunchdStatus } from "../api/tauri";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface AppStore {
  booted: boolean;
  paths: PathsInfo | null;
  status: RunnerStatus;
  logs: LogLine[];
  version: string | null;
  launchd: LaunchdStatus | null;

  boot: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  refreshPaths: () => Promise<void>;
  refreshVersion: () => Promise<void>;
  refreshLaunchd: () => Promise<void>;
  clearLogs: () => void;
}

const MAX_LOGS = 2000;
let logUnlisten: UnlistenFn | null = null;
let statusUnlisten: UnlistenFn | null = null;

export const useAppStore = create<AppStore>((set, get) => ({
  booted: false,
  paths: null,
  status: { status: "stopped" },
  logs: [],
  version: null,
  launchd: null,

  async boot() {
    if (get().booted) return;
    set({ booted: true });

    if (!logUnlisten) {
      logUnlisten = await onLog((line) => {
        const next = [...get().logs, line];
        if (next.length > MAX_LOGS) next.splice(0, next.length - MAX_LOGS);
        set({ logs: next });
      });
    }
    if (!statusUnlisten) {
      statusUnlisten = await onStatus((s) => set({ status: s }));
    }

    // Hydrate from persisted log file.
    try {
      const tail = await api.runnerTailLog(300);
      const parsed: LogLine[] = tail.map((line) => {
        if (line.startsWith("[stderr]")) return { stream: "stderr", line: line.slice(9) };
        if (line.startsWith("[stdout]")) return { stream: "stdout", line: line.slice(9) };
        return { stream: "system", line };
      });
      set({ logs: parsed });
    } catch {
      // ignore
    }

    await Promise.all([
      get().refreshPaths(),
      get().refreshStatus(),
      get().refreshVersion(),
      get().refreshLaunchd(),
    ]);
  },

  async refreshPaths() {
    try {
      const paths = await api.pathsInfo();
      set({ paths });
    } catch (e) {
      console.error(e);
    }
  },

  async refreshStatus() {
    try {
      const status = await api.runnerStatus();
      set({ status });
    } catch (e) {
      console.error(e);
    }
  },

  async refreshVersion() {
    try {
      const version = await api.frpcCurrentVersion();
      set({ version });
    } catch {
      set({ version: null });
    }
  },

  async refreshLaunchd() {
    try {
      const launchd = await api.launchdStatus();
      set({ launchd });
    } catch {
      set({ launchd: null });
    }
  },

  clearLogs() {
    set({ logs: [] });
  },
}));
