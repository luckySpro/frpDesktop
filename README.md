# frpDesktop

> 一款跨平台的 **frpc 桌面管家**，专为「HTTPS 单端口承载无数域名」场景而生。

![version](https://img.shields.io/github/v/release/luckySpro/frpDesktop?include_prereleases)
![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![stack](https://img.shields.io/badge/stack-Tauri%202%20%2B%20React%2018-orange)
![license](https://img.shields.io/github/license/luckySpro/frpDesktop)

---

## ✨ 这是什么

很多场景下服务器只放行 **443 端口**（公司/校园网/云服务商限制），而你又想把内网的多个服务通过 HTTPS 对外暴露 —— frp 本身支持 **SNI 多域名复用一个 443 端口**，但手写 TOML、管理 frpc 进程、处理证书路径仍然繁琐。

`frpDesktop` 就是为此而来：一个橙金暖色系的原生桌面应用，把 **frpc 的安装、配置、启停、开机自启、证书管理** 全部收拢到可视化界面，让你：

- 🔒 在只开放 443 的环境下，通过一个端口承载 **任意多个 HTTPS 域名**
- 🧩 覆盖 frp 全部 **8 种代理协议** + **9 种插件**，配置无死角
- 📦 内置 frpc 官方二进制在线下载，支持国内镜像加速
- 🖥 macOS / Windows / Linux 三端原生安装包，单击即用

## 📦 下载

访问 **[Releases](https://github.com/luckySpro/frpDesktop/releases)** 获取最新版本：

| 平台 | 安装包 |
|------|--------|
| macOS (Apple Silicon & Intel) | `frpDesktop_x.y.z_universal.dmg` |
| Windows x64 | `frpDesktop_x.y.z_x64-setup.exe` / `.msi` |
| Linux x64 | `*.AppImage` / `*.deb` / `*.rpm` |

> 首次打开：macOS 需「右键 → 打开」跳过 Gatekeeper；Windows 点击「仍要运行」跳过 SmartScreen（当前版本未做代码签名）。

## 🌟 主要功能

### 界面管理
- **仪表盘**：实时显示 frpc 运行状态、版本、配置文件路径、PID
- **配置编辑**：表单视图 + TOML 源码视图双向同步
  - 代理列表以 **紧凑卡片网格** 展示概要（名称 / 类型 / 域名 / 端口 / 加密压缩状态）
  - 点击任意卡片弹出 **Drawer 详情编辑面板**，按协议类型智能渲染所需字段
  - Monaco 编辑器提供 **TOML 语法高亮**（表头、键、字符串、布尔、注释独立着色）
- **设置面板**：frpc 二进制版本管理、镜像前缀配置、开机自启开关

### frp 协议全覆盖
| 代理类型 | 说明 |
|----------|------|
| `tcp` / `udp` | 端口透传 |
| `http` / `https` | 虚拟主机 / SNI 多域名复用 |
| `tcpmux` | 基于 host 的 TCP 多路复用 |
| `stcp` / `sudp` | 点对点加密 |
| `xtcp` | NAT 穿透 P2P |

| 插件类型 | 用途 |
|----------|------|
| `https2http` / `https2https` / `http2https` | 协议转换 |
| `static_file` | 静态文件服务器 |
| `unix_domain_socket` | Unix 套接字桥接 |
| `http_proxy` / `socks5` | 代理服务 |

通用 transport 选项一应俱全：`useEncryption` / `useCompression` / `bandwidthLimit` / `bandwidthLimitMode`。

### 安全通信
- **SNI 多域名复用**：单 443 端口承载无数 HTTPS 域名，通过 `customDomains` + `https2http` 插件自动分流
- **SSL 证书管理**：`crtPath` / `keyPath` 可直接从系统对话框选择文件自动导入到应用证书目录
- **请求头重写**：支持 `hostHeaderRewrite` 与 `requestHeaders.set` 键值对编辑

### frpc 服务控制
- 在线安装 / 切换任意历史版本（自动从 GitHub Release 获取版本列表）
- **GitHub 镜像加速**（如 `https://ghproxy.com/`）解决国内下载慢问题
- 一键启动 / 停止 / 重载配置，实时输出进程日志
- 进程状态监控与异常自动恢复

### 系统集成
- **菜单栏托盘**：关闭主窗口时隐藏至托盘而非退出进程，托盘菜单提供：
  - 显示 / 隐藏窗口
  - 启停 frpc 服务
  - 退出应用
- **开机自启**（macOS via launchd；其它平台随后支持）
- **跨平台统一图标**：橙色暖感品牌标识，dock / 托盘 / 窗口标题栏一致

## 🚀 快速上手

### 1. 服务端（frps）示例配置

```toml
bindPort = 7000

# HTTPS 多域名复用 443
vhostHTTPSPort = 443

auth.method = "token"
auth.token  = "your-strong-token"
```

### 2. 打开 frpDesktop，完成两步

1. **设置** → 「frpc 二进制管理」→ 点击「刷新版本列表」→ 选择一个版本点「安装」
2. **配置管理** → 填写服务端地址 / 端口 / token → 点击「新增代理」：
   - 类型选 `https`
   - `customDomains` 填你的域名，如 `cake.example.com`
   - 插件选 `https2http`，配置 `localAddr` 为内部 HTTP 服务
   - 选择 SSL 证书与私钥文件

### 3. 回到**仪表盘**点「启动」，即可通过域名对外访问。

## 🛠 开发

### 环境要求
- Node.js ≥ 20, pnpm ≥ 9
- Rust stable toolchain
- Tauri 2 平台依赖（见 [Tauri 文档](https://v2.tauri.app/start/prerequisites/)）

### 本地开发
```bash
git clone https://github.com/luckySpro/frpDesktop.git
cd frpDesktop/app
pnpm install
pnpm tauri dev
```

### 构建本机安装包
```bash
cd app
pnpm tauri build
# 产物位于 src-tauri/target/release/bundle/
```

### 发布（多平台）
推送 `v*` tag 会触发 [`.github/workflows/release.yml`](./.github/workflows/release.yml)，自动在 GitHub Actions 上为 macOS universal / Windows x64 / Linux x64 并行构建并上传到 Draft Release。

```bash
git tag -a v0.1.1 -m "frpDesktop v0.1.1"
git push origin v0.1.1
```

## 🧱 技术栈

- **前端**：React 18 + Vite 5 + TypeScript 5 + Ant Design 5 + Zustand + Monaco Editor
- **后端**：Tauri 2 + Rust（`toml` / `toml_edit` / `tokio` 异步进程管理）
- **打包**：tauri-cli + GitHub Actions (`tauri-apps/tauri-action`)

## 📐 项目结构

```
frpDesktop/
├── app/                   # 应用源码
│   ├── src/              # React 前端
│   ├── src-tauri/        # Rust 后端
│   │   └── src/config/   # TOML 读写与模型
│   └── package.json
├── .github/workflows/    # CI/CD 发布流水线
└── README.md
```

## 🤝 贡献

欢迎 Issue 与 PR。Bug 反馈请附带：
- 操作系统及版本
- frpDesktop 版本
- frpc 版本
- 复现步骤与 TOML 配置（记得脱敏 token / 证书 / 私钥）

## 📄 License

MIT © [luckySpro](https://github.com/luckySpro)
