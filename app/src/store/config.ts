import { create } from "zustand";
import { api, errText } from "../api/tauri";
import type { FrpcForm, ProxyForm, ValidationReport } from "../api/types";
import { normalizeProxy } from "../lib/proxy";

type Mode = "form" | "source";

interface ConfigStore {
  loaded: boolean;
  exists: boolean;
  /** Text currently on disk. */
  saved: string;
  /** Text the current `form` was parsed from (origin indices refer to it). */
  base: string;
  form: FrpcForm | null;
  source: string;
  mode: Mode;
  dirty: boolean;
  report: ValidationReport | null;
  parseError: string | null;

  load: () => Promise<void>;
  setForm: (f: FrpcForm) => void;
  upsertProxy: (index: number | null, p: ProxyForm) => void;
  removeProxy: (index: number) => void;
  setProxyEnabled: (index: number, enabled: boolean) => void;
  setSource: (text: string) => void;
  setMode: (m: Mode) => Promise<void>;
  /** Text that would be written right now. */
  currentText: () => Promise<string>;
  check: () => Promise<ValidationReport | null>;
  save: (force?: boolean) => Promise<ValidationReport>;
  replaceText: (text: string) => Promise<void>;
}

export const useConfig = create<ConfigStore>((set, get) => ({
  loaded: false,
  exists: false,
  saved: "",
  base: "",
  form: null,
  source: "",
  mode: "form",
  dirty: false,
  report: null,
  parseError: null,

  async load() {
    const { text, exists } = await api.configLoad();
    try {
      const form = await api.configParse(text);
      set({ loaded: true, exists, saved: text, base: text, form, source: text, dirty: false, parseError: null });
    } catch (e) {
      // Broken file: open the source view so the user can fix it.
      set({ loaded: true, exists, saved: text, base: text, form: null, source: text, mode: "source", dirty: false, parseError: errText(e) });
    }
    get().check();
  },

  setForm(form) {
    set({ form, dirty: true });
  },

  upsertProxy(index, p) {
    const form = get().form;
    if (!form) return;
    const proxies = form.proxies.slice();
    const clean = normalizeProxy(p);
    if (index === null) proxies.push(clean);
    else proxies[index] = clean;
    set({ form: { ...form, proxies }, dirty: true });
  },

  removeProxy(index) {
    const form = get().form;
    if (!form) return;
    set({ form: { ...form, proxies: form.proxies.filter((_, i) => i !== index) }, dirty: true });
  },

  setProxyEnabled(index, enabled) {
    const form = get().form;
    if (!form || !form.proxies[index]) return;
    const proxies = form.proxies.map((p, i) => (i === index ? { ...p, enabled } : p));
    set({ form: { ...form, proxies }, dirty: true });
  },

  setSource(text) {
    set({ source: text, dirty: text !== get().saved });
  },

  async setMode(m) {
    const st = get();
    if (m === st.mode) return;
    if (m === "source") {
      const text = await st.currentText();
      set({ mode: "source", source: text });
    } else {
      const form = await api.configParse(st.source); // throws on bad TOML
      set({ mode: "form", form, base: st.source, parseError: null });
    }
  },

  async currentText() {
    const st = get();
    if (st.mode === "source" || !st.form) return st.source;
    return api.configRender(st.base, st.form);
  },

  async check() {
    try {
      const report = await api.configCheck(await get().currentText());
      set({ report, parseError: null });
      return report;
    } catch (e) {
      set({ parseError: errText(e) });
      return null;
    }
  },

  async save(force = false) {
    const text = await get().currentText();
    const report = await api.configSave(text, force);
    set({ report });
    if (report.ok || force) {
      const form = await api.configParse(text);
      set({ saved: text, base: text, source: text, form, dirty: false, exists: true });
    }
    return report;
  },

  async replaceText(text) {
    const form = await api.configParse(text);
    set({ base: text, source: text, form, mode: "form", dirty: true });
    await get().check();
  },
}));
