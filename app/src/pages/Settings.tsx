import { useEffect, useState } from "react";
import { Alert, App, Button, Input, InputNumber, List, Popconfirm, Progress, Segmented, Space, Switch, Tag } from "antd";
import { CheckOutlined, CloudDownloadOutlined, DeleteOutlined, FolderOpenOutlined, ReloadOutlined } from "@ant-design/icons";
import { api, errText, events, isTauri, pickFiles } from "../api/tauri";
import type { VersionEntry } from "../api/types";
import { useApp } from "../store/app";

const MIRRORS = ["https://gh-proxy.com/", "https://ghfast.top/"];

function Row({ title, desc, children }: { title: React.ReactNode; desc?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="text">
        <div className="title">{title}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function Settings() {
  const { message } = App.useApp();
  const info = useApp((s) => s.info);
  const settings = useApp((s) => s.settings);
  const daemon = useApp((s) => s.daemon);
  const saveSettings = useApp((s) => s.saveSettings);
  const refreshInfo = useApp((s) => s.refreshInfo);
  const refreshDaemon = useApp((s) => s.refreshDaemon);
  const refreshSettings = useApp((s) => s.refreshSettings);

  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [installed, setInstalled] = useState<string[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [mirror, setMirror] = useState("");
  const [autostart, setAutostart] = useState<boolean | null>(null);

  useEffect(() => setMirror(settings?.mirrorPrefix ?? ""), [settings?.mirrorPrefix]);

  const loadInstalled = () => api.frpcInstalled().then(setInstalled).catch(() => {});
  const loadVersions = async () => {
    setLoadingList(true);
    setListError(null);
    try {
      setVersions(await api.frpcListVersions());
    } catch (e) {
      setListError(errText(e));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadInstalled();
    loadVersions();
    api.autostartGet().then(setAutostart).catch(() => setAutostart(null));
    const un = events.onInstallProgress((p) => p.total > 0 && setProgress(Math.round((p.downloaded / p.total) * 100)));
    return () => {
      un.then((u) => u());
    };
  }, []);

  const guard = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) message.success(ok);
    } catch (e) {
      message.error(errText(e));
    }
  };

  const install = async (v: VersionEntry) => {
    setInstalling(v.version);
    setProgress(0);
    await guard(async () => {
      await api.frpcInstall(v);
      await Promise.all([refreshInfo(), refreshSettings(), loadInstalled(), refreshDaemon()]);
    }, `已安装并切换到 frpc v${v.version}`);
    setInstalling(null);
    loadVersions();
  };

  const useVersion = (v: string) =>
    guard(async () => {
      await api.frpcUse(v);
      await Promise.all([refreshInfo(), refreshSettings(), refreshDaemon()]);
    }, `已切换到 frpc v${v}`);

  const pickCustom = async () => {
    const [file] = await pickFiles({ title: "选择 frpc 可执行文件" });
    if (!file) return;
    await guard(async () => {
      await saveSettings({ frpcCustomPath: file });
      await refreshInfo();
    }, "已使用自定义 frpc");
  };

  const active = settings?.frpcCustomPath ? null : settings?.frpcVersion ?? info?.frpcVersion ?? null;
  const p = info?.paths;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>frpc 程序</h2>
          {info?.frpcVersion ? <Tag color="success">当前 v{info.frpcVersion}</Tag> : <Tag color="warning">未安装</Tag>}
          <span className="faint">{info?.platform}</span>
        </div>
        <div className="panel-body">
          <Row title="下载镜像" desc="国内网络可选择 GitHub 加速镜像。下载后会用官方 SHA256 校验文件核对完整性。">
            <Space.Compact style={{ width: 320, maxWidth: "100%" }}>
              <Input
                value={mirror}
                placeholder="直连 GitHub"
                onChange={(e) => setMirror(e.target.value)}
                onBlur={() => mirror !== settings?.mirrorPrefix && guard(() => saveSettings({ mirrorPrefix: mirror }), "镜像已保存")}
              />
            </Space.Compact>
          </Row>
          <div style={{ marginTop: -6, marginBottom: 10 }}>
            <Space size={4} wrap>
              <span className="faint">常用：</span>
              {["", ...MIRRORS].map((m) => (
                <Tag.CheckableTag
                  key={m || "direct"}
                  checked={(settings?.mirrorPrefix ?? "") === m}
                  onChange={() => guard(() => saveSettings({ mirrorPrefix: m }))}
                >
                  {m || "直连"}
                </Tag.CheckableTag>
              ))}
            </Space>
          </div>

          {settings?.frpcCustomPath && (
            <Alert
              style={{ marginBottom: 12 }}
              type="info"
              showIcon
              message={<span>正在使用自定义 frpc：<span className="mono">{settings.frpcCustomPath}</span></span>}
              action={
                <Button size="small" onClick={() => guard(async () => { await saveSettings({ frpcCustomPath: null }); await refreshInfo(); })}>
                  改用内置版本
                </Button>
              }
            />
          )}

          {installing && (
            <Alert style={{ marginBottom: 12 }} type="info" message={`正在下载 frpc v${installing}…`} description={<Progress percent={progress} status="active" />} />
          )}

          <Space style={{ marginBottom: 10 }} wrap>
            <Button size="small" icon={<ReloadOutlined />} loading={loadingList} onClick={loadVersions}>
              刷新版本列表
            </Button>
            {isTauri && (
              <Button size="small" icon={<FolderOpenOutlined />} onClick={pickCustom}>
                使用已有的 frpc…
              </Button>
            )}
          </Space>
          {listError && <Alert style={{ marginBottom: 10 }} type="warning" showIcon message="获取版本列表失败" description={listError} />}

          <List
            size="small"
            bordered
            loading={loadingList}
            dataSource={versions.length ? versions : installed.map((v) => ({ tag: `v${v}`, version: v, prerelease: false, installed: true } as VersionEntry))}
            renderItem={(v) => {
              const isInstalled = installed.includes(v.version);
              const isActive = active === v.version;
              return (
                <List.Item
                  actions={[
                    isInstalled && !isActive && (
                      <Button key="use" size="small" icon={<CheckOutlined />} onClick={() => useVersion(v.version)}>
                        使用
                      </Button>
                    ),
                    !isInstalled && (
                      <Button key="install" size="small" type="primary" ghost icon={<CloudDownloadOutlined />} disabled={!v.assetUrl || !!installing} loading={installing === v.version} onClick={() => install(v)}>
                        {v.assetUrl ? "下载" : "无此平台包"}
                      </Button>
                    ),
                    isInstalled && !isActive && (
                      <Popconfirm key="rm" title={`删除 v${v.version}？`} onConfirm={() => guard(async () => { await api.frpcUninstall(v.version); await loadInstalled(); })}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="删除版本" />
                      </Popconfirm>
                    ),
                  ].filter(Boolean)}
                >
                  <Space wrap>
                    <span className="mono" style={{ fontWeight: 600 }}>
                      {v.tag}
                    </span>
                    {isActive && <Tag color="success">使用中</Tag>}
                    {isInstalled && !isActive && <Tag>已安装</Tag>}
                    {v.prerelease && <Tag color="orange">预发布</Tag>}
                    {v.publishedAt && <span className="faint">{new Date(v.publishedAt).toLocaleDateString("zh-CN")}</span>}
                  </Space>
                </List.Item>
              );
            }}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>运行方式</h2>
        </div>
        <div className="panel-body">
          <Row title="意外退出后自动重启" desc="frpc 崩溃或断开退出时按 2、4、8… 秒间隔重启，连续失败 5 次后停止。">
            <Switch checked={!!settings?.autoRestart} onChange={(v) => guard(() => saveSettings({ autoRestart: v }))} />
          </Row>
          <Row title="打开 frpDesktop 时自动启动 frpc">
            <Switch checked={!!settings?.startFrpcOnLaunch} onChange={(v) => guard(() => saveSettings({ startFrpcOnLaunch: v }))} />
          </Row>
          <Row title="登录系统时启动 frpDesktop" desc="以托盘方式在后台启动，配合上一项即可开机自动连接。适用于所有平台。">
            <Switch
              checked={!!autostart}
              disabled={autostart === null}
              onChange={(v) => guard(async () => setAutostart(await api.autostartSet(v)))}
            />
          </Row>
          <Row
            title={`后台服务（${daemon?.kind === "launchd" ? "launchd" : daemon?.kind === "systemd" ? "systemd --user" : "不支持"}）`}
            desc={
              daemon?.supported
                ? daemon.installed
                  ? `frpc 由系统托管，退出 frpDesktop 也会继续运行。${daemon.binary ? `程序：${daemon.binary}` : ""}`
                  : "让系统托管 frpc：不打开 frpDesktop 也会开机运行。启用时会停止应用内的 frpc，避免同时运行两个。"
                : "当前系统不支持，请使用上面的「登录时启动 frpDesktop」。"
            }
          >
            <Switch
              checked={!!daemon?.installed}
              disabled={!daemon?.supported}
              onChange={(v) =>
                guard(async () => {
                  if (v) await api.daemonEnable();
                  else await api.daemonDisable();
                  await refreshDaemon();
                }, v ? "后台服务已启用" : "后台服务已关闭")
              }
            />
          </Row>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>访问链接与外观</h2>
        </div>
        <div className="panel-body">
          <Row title="frps HTTPS 端口 (vhostHTTPSPort)" desc="用于生成站点访问链接。frps 使用 443 时链接里不显示端口。">
            <InputNumber min={1} max={65535} value={settings?.httpsPort} onChange={(v) => v && guard(() => saveSettings({ httpsPort: v }))} />
          </Row>
          <Row title="frps HTTP 端口 (vhostHTTPPort)">
            <InputNumber min={1} max={65535} value={settings?.httpPort} onChange={(v) => v && guard(() => saveSettings({ httpPort: v }))} />
          </Row>
          <Row title="主题">
            <Segmented
              value={settings?.theme ?? "system"}
              onChange={(v) => guard(() => saveSettings({ theme: v as "system" | "light" | "dark" }))}
              options={[
                { value: "system", label: "跟随系统" },
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" },
              ]}
            />
          </Row>
        </div>
      </section>

      {p && (
        <section className="panel">
          <div className="panel-head">
            <h2>数据目录</h2>
          </div>
          <div className="panel-body">
            {[
              ["应用数据", p.dataDir],
              ["配置文件", p.defaultProfile],
              ["证书库", p.certsDir],
              ["日志", p.logFile],
            ].map(([label, path]) => (
              <Row key={label} title={label} desc={<span className="mono">{path}</span>}>
                <Button size="small" icon={<FolderOpenOutlined />} onClick={() => guard(() => api.revealPath(path))}>
                  打开
                </Button>
              </Row>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
