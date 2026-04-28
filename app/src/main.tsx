import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#f97316",
          colorInfo: "#f97316",
          colorSuccess: "#10b981",
          colorWarning: "#f59e0b",
          colorError: "#ef4444",
          colorLink: "#f97316",
          colorBgLayout: "#fff8f1",
          borderRadius: 10,
          fontSize: 14,
          wireframe: false,
        },
        components: {
          Menu: {
            darkItemBg: "transparent",
            darkItemSelectedBg: "rgba(249, 115, 22, 0.2)",
            darkItemHoverBg: "rgba(255,255,255,0.06)",
            darkItemColor: "#fcd9b6",
            darkItemSelectedColor: "#fff",
          },
          Button: {
            primaryShadow: "0 4px 10px rgba(249, 115, 22, 0.25)",
          },
          Card: {
            borderRadiusLG: 14,
          },
          Tabs: {
            inkBarColor: "#f97316",
            itemSelectedColor: "#ea580c",
            itemHoverColor: "#f97316",
          },
          Switch: {
            colorPrimary: "#f97316",
            colorPrimaryHover: "#ea580c",
          },
          Tag: {
            defaultBg: "#fff7ed",
            defaultColor: "#9a3412",
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
