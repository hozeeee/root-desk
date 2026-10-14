import { useEffect, useState } from "react";
import {
  Check,
  Download,
  ExternalLink,
  Moon,
  Network,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  Sun,
  Wrench,
} from "lucide-react";
import type {
  AppSettings,
  BinaryStatus,
  UpdateStatus,
} from "@shared/contracts";
import { useApp } from "../../app/AppContext";
import { PageHeader } from "../../components/PageHeader";
import { Badge, Notice, Spinner } from "../../components/Ui";

export function SettingsPage(): JSX.Element {
  const { settings, updateSettings, appInfo, reloadContent, content } =
    useApp();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [proxyResult, setProxyResult] = useState<string | null>(null);
  const [tools, setTools] = useState<BinaryStatus[]>([]);
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false);
  useEffect(() => {
    setDraft(settings);
  }, [settings]);
  useEffect(() => {
    void window.rootDesk
      .getUpdateStatus()
      .then(setUpdate)
      .catch((reason) => setError(message(reason)));
  }, []);
  if (!draft) return <></>;
  const run = async (
    id: string,
    action: () => Promise<void>,
  ): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy("");
    }
  };
  const saveDraft = async (): Promise<void> => {
    await updateSettings({
      ...draft,
      proxyPassword: clearPassword ? "" : password || undefined,
    });
    setPassword("");
    setClearPassword(false);
    setSaved(true);
  };
  const setProxy = (patch: Partial<AppSettings["proxy"]>): void => {
    setSaved(false);
    setDraft({ ...draft, proxy: { ...draft.proxy, ...patch } });
  };
  const patchDraft = (patch: Partial<AppSettings>): void => {
    setSaved(false);
    setDraft({ ...draft, ...patch });
  };
  return (
    <div className="page-stack settings-page">
      <PageHeader
        eyebrow="PREFERENCES"
        title="设置"
        description="界面偏好、官方工具、网络连接与可信内容发布来源。"
        actions={
          <button
            className="button primary"
            disabled={Boolean(busy)}
            onClick={() => void run("save", saveDraft)}
          >
            {busy === "save" ? (
              <Spinner />
            ) : saved ? (
              <Check size={16} />
            ) : (
              <Save size={16} />
            )}{" "}
            {saved ? "已保存" : "保存设置"}
          </button>
        }
      />
      {error && <Notice danger>{error}</Notice>}
      <div className="settings-layout">
        <nav className="settings-nav panel">
          <a href="#appearance">
            <Sun size={17} />
            外观
          </a>
          <a href="#platform">
            <Wrench size={17} />
            Platform Tools
          </a>
          <a href="#network">
            <Network size={17} />
            网络代理
          </a>
          <a href="#security">
            <Shield size={17} />
            安全
          </a>
          <a href="#content-update">
            <RefreshCw size={17} />
            资料更新
          </a>
        </nav>
        <div className="settings-content">
          <section id="appearance" className="panel setting-section">
            <div className="setting-title">
              <span className="section-icon">
                <Sun size={19} />
              </span>
              <div>
                <h3>外观</h3>
                <p>选择适合当前工作环境的显示模式。</p>
              </div>
            </div>
            <div className="theme-options">
              {(["dark", "light", "system"] as const).map((theme) => (
                <button
                  key={theme}
                  className={draft.theme === theme ? "active" : ""}
                  onClick={() => patchDraft({ theme })}
                >
                  {theme === "dark" ? (
                    <Moon />
                  ) : theme === "light" ? (
                    <Sun />
                  ) : (
                    <span className="theme-auto">A</span>
                  )}
                  <strong>
                    {theme === "dark"
                      ? "深色"
                      : theme === "light"
                        ? "浅色"
                        : "跟随系统"}
                  </strong>
                  <small>
                    {theme === "dark"
                      ? "适合长时间工具操作"
                      : theme === "light"
                        ? "适合明亮环境"
                        : "根据系统自动切换"}
                  </small>
                </button>
              ))}
            </div>
          </section>
          <section id="platform" className="panel setting-section">
            <div className="setting-title">
              <span className="section-icon">
                <Wrench size={19} />
              </span>
              <div>
                <h3>Android Platform Tools</h3>
                <p>
                  留空时检测系统 PATH；也可由 RootDesk 下载官方版本并独立管理。
                </p>
              </div>
            </div>
            <label className="field">
              <span>自定义目录或可执行文件路径</span>
              <input
                value={draft.platformToolsPath ?? ""}
                onChange={(event) =>
                  patchDraft({
                    platformToolsPath: event.target.value || undefined,
                  })
                }
                placeholder="/path/to/platform-tools"
              />
            </label>
            <p className="section-help">
              安装前请阅读{" "}
              <a
                href="https://developer.android.com/studio/terms"
                target="_blank"
                rel="noreferrer"
              >
                Android SDK 许可条款
              </a>
              。安装仅下载 Google 官方工具，不安装驱动，也不连接或刷写手机。
            </p>
            <div className="inline-actions">
              <button
                className="button secondary"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run("detect", async () =>
                    setTools(await window.rootDesk.detectPlatformTools()),
                  )
                }
              >
                <Wrench size={14} />
                检测工具
              </button>
              <button
                className="button primary"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run("install-tools", async () => {
                    await saveDraft();
                    setTools(await window.rootDesk.installPlatformTools());
                    await updateSettings({});
                    setDraft(await window.rootDesk.getSettings());
                  })
                }
              >
                {busy === "install-tools" ? (
                  <Spinner />
                ) : (
                  <Download size={14} />
                )}{" "}
                接受许可并安装官方工具
              </button>
            </div>
            {tools.map((tool) => (
              <p className="section-help" key={tool.name}>
                {tool.name}：{tool.available ? tool.version : tool.error}
              </p>
            ))}
          </section>
          <section id="network" className="panel setting-section">
            <div className="setting-title">
              <span className="section-icon">
                <Network size={19} />
              </span>
              <div>
                <h3>网络代理</h3>
                <p>下载、GitHub 与内容更新使用同一 Electron 网络会话。</p>
              </div>
            </div>
            <div className="segmented wide">
              <button
                className={draft.proxy.mode === "system" ? "active" : ""}
                onClick={() => setProxy({ mode: "system" })}
              >
                使用系统代理
              </button>
              <button
                className={draft.proxy.mode === "custom" ? "active" : ""}
                onClick={() => setProxy({ mode: "custom" })}
              >
                自定义代理
              </button>
            </div>
            {draft.proxy.mode === "custom" && (
              <div className="form-grid">
                <label className="field">
                  <span>协议</span>
                  <select
                    value={draft.proxy.protocol}
                    onChange={(event) =>
                      setProxy({
                        protocol: event.target
                          .value as AppSettings["proxy"]["protocol"],
                      })
                    }
                  >
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                    <option value="socks5">SOCKS5</option>
                  </select>
                </label>
                <label className="field grow">
                  <span>主机</span>
                  <input
                    value={draft.proxy.host}
                    onChange={(event) => setProxy({ host: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>端口</span>
                  <input
                    type="number"
                    value={draft.proxy.port}
                    onChange={(event) =>
                      setProxy({ port: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  <span>用户名（可选）</span>
                  <input
                    value={draft.proxy.username ?? ""}
                    onChange={(event) =>
                      setProxy({ username: event.target.value || undefined })
                    }
                  />
                </label>
                <label className="field">
                  <span>密码（仅本次会话）</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={draft.proxy.hasCredential ? "已设置" : ""}
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={clearPassword}
                    onChange={(event) => setClearPassword(event.target.checked)}
                  />
                  清除已保存的会话凭证
                </label>
              </div>
            )}
            <Notice>
              HTTP(S) 代理支持认证，凭证不写入磁盘；Chromium SOCKS5
              仅支持无认证代理。启用系统代理将清空本次自定义凭证。
            </Notice>
            <div className="inline-actions">
              <button
                className="button secondary"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run("proxy-test", async () => {
                    await saveDraft();
                    const result = await window.rootDesk.testProxy();
                    setProxyResult(
                      `${result.ok ? "连接成功" : "连接失败"} · ${result.latencyMs} ms · ${result.resolvedProxy} · ${result.message}`,
                    );
                  })
                }
              >
                {busy === "proxy-test" ? <Spinner /> : <Network size={14} />}
                保存并测试连通性
              </button>
            </div>
            {proxyResult && <p className="section-help">{proxyResult}</p>}
          </section>
          <section id="security" className="panel setting-section">
            <div className="setting-title">
              <span className="section-icon">
                <Shield size={19} />
              </span>
              <div>
                <h3>专家模式</h3>
                <p>
                  仅当前会话有效，重启自动关闭；开启后仍不能跳过设备绑定和执行预览。
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  aria-label="开启专家模式"
                  checked={draft.expertMode}
                  onChange={(event) =>
                    patchDraft({ expertMode: event.target.checked })
                  }
                />
                <span />
              </label>
            </div>
            {draft.expertMode && (
              <Notice danger>
                刷写、解锁、回锁和清除数据可能永久损坏设备。必须核对序列号、固件、分区和恢复计划，并逐次输入确认词。应用不提供账号锁、FRP
                或 MDM 绕过。
              </Notice>
            )}
          </section>
          <section id="content-update" className="panel setting-section">
            <div className="setting-title">
              <span className="section-icon">
                <RefreshCw size={19} />
              </span>
              <div>
                <h3>GitHub Releases 资料更新</h3>
                <p>
                  当前资料 v{content?.catalog?.version ?? "未知"}
                  ；与应用版本独立。仅更新指南与工具，不更新可执行命令白名单。
                </p>
              </div>
            </div>
            <label className="field">
              <span>维护者仓库（owner/repo）</span>
              <input
                value={draft.contentRepository ?? ""}
                onChange={(event) =>
                  patchDraft({ contentRepository: event.target.value })
                }
                placeholder="your-organization/rootdesk-content"
              />
            </label>
            <label className="field">
              <span>可信 Ed25519 公钥（PEM）</span>
              <textarea
                value={draft.contentPublicKey ?? ""}
                onChange={(event) =>
                  patchDraft({ contentPublicKey: event.target.value })
                }
                placeholder="-----BEGIN PUBLIC KEY-----"
                rows={4}
              />
              <small>
                请从你信任的维护者独立获取公钥。不能信任与内容包一起下载的新公钥。
              </small>
            </label>
            <Notice>
              安装前必须通过公钥签名、SHA-256、文件大小与资料结构校验；失败时保留原内容。此项目没有擅自绑定第三方发布仓库。
            </Notice>
            <div className="inline-actions">
              <button
                className="button secondary"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run("check-update", async () => {
                    await saveDraft();
                    setUpdate(await window.rootDesk.checkForUpdates());
                  })
                }
              >
                {busy === "check-update" ? (
                  <Spinner />
                ) : (
                  <RefreshCw size={14} />
                )}{" "}
                保存并检查资料更新
              </button>
              {update?.state === "available" && (
                <button
                  className="button primary"
                  disabled={Boolean(busy) || !draft.contentPublicKey?.trim()}
                  onClick={() =>
                    void run("install-update", async () => {
                      await saveDraft();
                      setUpdate(await window.rootDesk.installContentUpdate());
                      await reloadContent();
                    })
                  }
                >
                  {busy === "install-update" ? (
                    <Spinner />
                  ) : (
                    <Download size={14} />
                  )}{" "}
                  校验并安装 v{update.latestVersion}
                </button>
              )}
              {update?.releaseUrl && (
                <a
                  className="button ghost"
                  href={update.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  发布说明
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
            {update && <p className="section-help">{update.message}</p>}
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={rollbackConfirmed}
                onChange={(event) => setRollbackConfirmed(event.target.checked)}
              />
              我希望回退到上一版资料或内置版本
            </label>
            <button
              className="button ghost"
              disabled={Boolean(busy) || !rollbackConfirmed}
              onClick={() =>
                void run("rollback", async () => {
                  await window.rootDesk.rollbackContent();
                  await reloadContent();
                  setRollbackConfirmed(false);
                  setUpdate(await window.rootDesk.getUpdateStatus());
                })
              }
            >
              <RotateCcw size={14} /> 回退资料
            </button>
          </section>
          <section className="panel setting-section about-row">
            <div>
              <span className="eyebrow">APPLICATION</span>
              <h3>RootDesk {appInfo?.version}</h3>
              <p>
                {appInfo?.platform} / {appInfo?.arch} ·
                离线知识库与安全设备工具台
              </p>
            </div>
            <Badge tone="accent">内容与应用独立版本</Badge>
          </section>
        </div>
      </div>
    </div>
  );
}
function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
