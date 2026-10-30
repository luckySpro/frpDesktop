import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import { useApp } from "./store/app";
import "./styles/global.css";

function useResolvedTheme(): "light" | "dark" {
  const pref = useApp((s) => s.settings?.theme ?? "system");
  const forced = new URLSearchParams(location.search).get("theme");
  const [sys, setSys] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = (e: MediaQueryListEvent) => setSys(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  if (forced === "dark" || forced === "light") return forced;
  if (pref === "dark" || pref === "light") return pref;
  return sys ? "dark" : "light";
}

function Root() {
  const mode = useResolvedTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: "#f97316",
          colorLink: "#f97316",
          colorSuccess: "#16a34a",
          colorWarning: "#d97706",
          colorError: "#dc2626",
          borderRadius: 8,
          fontSize: 14,
          colorBgLayout: mode === "dark" ? "#141210" : "#f7f5f2",
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
