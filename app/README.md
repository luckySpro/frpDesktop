# frpDesktop

macOS 上的 frpc 管理工具（Lucky'Tool）。

## 特性
- 表单 / TOML 源码双视图编辑 frpc.toml（完整支持 `https2http` 插件、`crtPath/keyPath`、`requestHeaders.set`）
- 子进程守护 frpc，实时日志流
- 一键从 GitHub Releases 下载并切换 frpc 版本（可选镜像前缀）
- 可选启用 launchd LaunchAgent 开机自启
- 首次启动自动提示从工作区导入已有 `frpc.toml` 与证书

## 目录结构

```
app/
├── package.json              # 前端
├── vite.config.ts
├── index.html
├── src/                      # React 代码
│   ├── api/tauri.ts          # 与 Rust 后端的所有 invoke 封装
│   ├── store/app.ts          # 全局状态 (zustand)
│   ├── pages/
│   │   ├── Dashboard.tsx     # 状态 + 日志
│   │   ├── Config.tsx        # 表单/源码双视图
│   │   └── Settings.tsx      # 版本管理 / 自启 / 目录
│   └── App.tsx
└── src-tauri/                # Rust 代码
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/default.json
    └── src/
        ├── main.rs / lib.rs
        ├── paths.rs          # 应用数据目录
        ├── error.rs
        ├── config/mod.rs     # TOML 解析 / 表单互转 / 校验
        ├── frpc/mod.rs       # 版本列表 / 下载 / 安装
        ├── runner/
        │   ├── process.rs    # 子进程守护与日志
        │   └── launchd.rs    # LaunchAgent plist
        └── commands/mod.rs   # Tauri command 入口
```

应用数据目录：`~/Library/Application Support/com.ueware.frpdesktop/`

## 开发

```bash
cd app
pnpm install
pnpm tauri dev
```

首次启动若检测到 `/Users/lucky/Documents/WorkSapce/frpDesktop/frpc.toml`，
应用会弹窗询问是否一键导入该配置与证书。

## 构建 macOS 应用

```bash
cd app
pnpm tauri build                      # 当前架构
pnpm tauri build --target universal-apple-darwin  # universal（需同时安装 x86_64 + aarch64 toolchain）
```

产物：`app/src-tauri/target/release/bundle/`

未签名时首次运行需要解除 quarantine：

```bash
xattr -dr com.apple.quarantine "/Applications/frpDesktop.app"
```

## 自定义图标

仓库中只放了 1x1 的占位 `app/src-tauri/icons/icon.png`。若需要品牌图标，
放入高清 1024x1024 PNG 后可用 Tauri CLI 生成整套图标：

```bash
pnpm tauri icon path/to/your-icon.png
```
