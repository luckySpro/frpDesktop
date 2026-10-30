import { useMemo } from "react";
import { App, Button, Empty, Progress, Space, Tag, Tooltip } from "antd";
import { DeleteOutlined, FolderOpenOutlined, ImportOutlined, KeyOutlined, ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { api, errText, isTauri, pickFiles } from "../api/tauri";
import type { CertFile } from "../api/types";
import { useApp } from "../store/app";
import { useConfig } from "../store/config";

const fmt = (ts: number) => new Date(ts * 1000).toLocaleDateString("zh-CN");

function expiryTag(days: number) {
  if (days < 0) return <Tag color="error">已过期</Tag>;
  if (days <= 15) return <Tag color="warning">{days} 天后过期</Tag>;
  return <Tag color="success">剩余 {days} 天</Tag>;
}

export default function Certificates() {
  const { message, modal } = App.useApp();
  const certs = useApp((s) => s.certs);
  const info = useApp((s) => s.info);
  const refresh = useApp((s) => s.refreshCerts);
  const form = useConfig((s) => s.form);

  const usedBy = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of form?.proxies ?? []) {
      for (const path of [p.plugin?.crtPath, p.plugin?.keyPath]) {
        if (!path) continue;
        const name = path.replace(/^\.\/certs\//, "");
        m.set(name, [...(m.get(name) ?? []), p.name]);
      }
    }
    return m;
  }, [form]);

  const importFiles = async () => {
    const files = await pickFiles({ title: "选择证书和私钥（可多选）", multiple: true, extensions: ["crt", "pem", "cer", "key"] });
    if (!files.length) return;
    try {
      await api.certsImport(files);
      await refresh();
      message.success(`已导入 ${files.length} 个文件`);
    } catch (e) {
      message.error(errText(e));
    }
  };

  const remove = (c: CertFile) => {
    const users = usedBy.get(c.fileName) ?? [];
    modal.confirm({
      title: `删除 ${c.fileName}？`,
      content: users.length ? `仍有代理在使用：${users.join("、")}。删除后这些代理将无法启动。` : "此操作不可撤销。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.certsDelete(c.fileName);
          await refresh();
        } catch (e) {
          message.error(errText(e));
        }
      },
    });
  };

  const main = certs.filter((c) => c.kind !== "key" || !c.pair);

  return (
    <>
      <section className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head" style={{ borderBottom: 0 }}>
          <div>
            <h2>证书库</h2>
            <div className="faint">
              导入的证书统一放在应用数据目录的 certs/ 下，配置里用 ./certs/文件名 引用。支持 PEM 格式（.crt / .pem / .key），证书文件可包含完整证书链。
            </div>
          </div>
          <div className="spacer" />
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={refresh}>
              刷新
            </Button>
            {info && (
              <Button icon={<FolderOpenOutlined />} onClick={() => api.revealPath(info.paths.certsDir).catch((e) => message.error(errText(e)))}>
                打开目录
              </Button>
            )}
            {isTauri && (
              <Button type="primary" icon={<ImportOutlined />} onClick={importFiles}>
                导入证书 / 私钥
              </Button>
            )}
          </Space>
        </div>
      </section>

      {main.length === 0 ? (
        <section className="panel">
          <Empty style={{ padding: 32 }} description="证书库是空的。导入你的域名证书（.crt）和私钥（.key）后，就能在 HTTPS 站点里直接选择。" />
        </section>
      ) : (
        <div className="cert-grid">
          {main.map((c) => {
            const users = [...new Set([...(usedBy.get(c.fileName) ?? []), ...(c.pair ? usedBy.get(c.pair) ?? [] : [])])];
            const ci = c.cert;
            const total = ci ? Math.max(1, (ci.notAfter - ci.notBefore) / 86400) : 1;
            const pct = ci ? Math.min(100, Math.max(0, (ci.daysLeft / total) * 100)) : 0;
            return (
              <div className="panel cert-card" key={c.fileName}>
                <Space align="start" style={{ justifyContent: "space-between", width: "100%" }}>
                  <Space align="start">
                    {c.kind === "key" ? <KeyOutlined style={{ fontSize: 18, color: "var(--text-2)" }} /> : <SafetyCertificateOutlined style={{ fontSize: 18, color: "var(--brand)" }} />}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{ci ? ci.dnsNames.join(", ") : c.fileName}</div>
                      <div className="faint mono">{c.fileName}</div>
                    </div>
                  </Space>
                  <Tooltip title="删除">
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(c)} aria-label={`删除 ${c.fileName}`} />
                  </Tooltip>
                </Space>
                {c.error && <div style={{ color: "var(--err)", fontSize: 13 }}>{c.error}</div>}
                {ci && (
                  <>
                    <Space wrap size={4}>
                      {expiryTag(ci.daysLeft)}
                      {c.pair ? (
                        <Tag icon={<KeyOutlined />} color="blue" bordered={false}>
                          私钥 {c.pair}
                        </Tag>
                      ) : (
                        <Tag color="error">缺少匹配的私钥</Tag>
                      )}
                      {ci.selfSigned && <Tag color="warning">自签名</Tag>}
                      {ci.chainLen > 1 && <Tag bordered={false}>含证书链</Tag>}
                    </Space>
                    <Progress
                      percent={pct}
                      showInfo={false}
                      size="small"
                      status={ci.daysLeft < 0 ? "exception" : ci.daysLeft <= 15 ? "active" : "normal"}
                      strokeColor={ci.daysLeft <= 15 ? "#d97706" : "#16a34a"}
                    />
                    <div className="faint">
                      {ci.issuer} · {fmt(ci.notBefore)} – {fmt(ci.notAfter)}
                    </div>
                  </>
                )}
                {c.kind === "key" && !c.pair && <div className="faint">没有找到与之配对的证书</div>}
                <div className="faint">{users.length ? `使用中：${users.join("、")}` : "未被代理使用"}</div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
