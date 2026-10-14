import { useMemo, useState } from "react";
import {
  Boxes,
  Download,
  ExternalLink,
  Filter,
  Search,
  Wrench,
} from "lucide-react";
import type { ToolAsset, ToolDefinition } from "@shared/contracts";
import { useApp } from "../../app/AppContext";
import { PageHeader } from "../../components/PageHeader";
import { Badge, EmptyState, Notice, Spinner } from "../../components/Ui";

const labels: Record<string, string> = {
  "platform-tools": "平台工具",
  driver: "驱动",
  root: "Root",
  recovery: "Recovery",
  utility: "实用工具",
  firmware: "固件",
};
const supportedAssets = new Set([
  "android-platform-tools",
  "magisk",
  "payload-dumper-go",
]);

export function ToolsPage({
  initialQuery = "",
}: {
  initialQuery?: string;
}): JSX.Element {
  const { content, appInfo, updateSettings } = useApp();
  const tools = content?.tools?.tools ?? [];
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState(initialQuery);
  const [platform, setPlatform] = useState("all");
  const [assets, setAssets] = useState<Record<string, ToolAsset[]>>({});
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const shown = useMemo(
    () =>
      tools.filter(
        (tool) =>
          (category === "all" || tool.category === category) &&
          (platform === "all" ||
            tool.platforms.includes(
              platform as (typeof tool.platforms)[number],
            )) &&
          `${tool.name} ${tool.summary} ${tool.tags.join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [tools, category, platform, query],
  );
  const categories = [...new Set(tools.map((tool) => tool.category))];
  const run = async (
    id: string,
    action: () => Promise<void>,
  ): Promise<void> => {
    setBusy(id);
    setFeedback(null);
    try {
      await action();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };
  const getAssets = (tool: ToolDefinition): Promise<void> =>
    run(tool.id, async () => {
      const next = await window.rootDesk.getToolAssets(tool.id);
      const hostPlatform =
        appInfo?.platform === "darwin"
          ? "macos"
          : appInfo?.platform === "win32"
            ? "windows"
            : "linux";
      next.sort(
        (a, b) =>
          Number(b.platform === hostPlatform || b.platform === "android") -
          Number(a.platform === hostPlatform || a.platform === "android"),
      );
      setAssets((previous) => ({ ...previous, [tool.id]: next }));
      if (!next.length)
        setFeedback("发布者没有提供可识别的安装包，请访问官方来源。");
    });
  const download = (asset: ToolAsset): Promise<void> =>
    run(asset.name, async () => {
      await window.rootDesk.startDownload({
        url: asset.url,
        fileName: asset.name,
        sha256: asset.sha256,
      });
      setFeedback(
        "下载任务已创建，可在下载中心查看进度和定位文件。下载不会自动安装或执行。",
      );
    });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="TRUSTED TOOL INDEX"
        title="工具目录"
        description="桌面工具、驱动和手机 APK：了解用途，阅读安装方法，再从发布者获取资源。"
      />
      <div className="toolbar panel">
        <div className="inline-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选工具…"
            aria-label="筛选工具"
          />
        </div>
        <select
          className="platform-select"
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
          aria-label="平台筛选"
        >
          <option value="all">所有平台</option>
          <option value="windows">Windows</option>
          <option value="macos">macOS</option>
          <option value="android">Android</option>
          <option value="linux">Linux</option>
        </select>
        <div className="category-filter">
          <Filter size={16} />
          <button
            className={category === "all" ? "active" : ""}
            onClick={() => setCategory("all")}
          >
            全部
          </button>
          {categories.map((item) => (
            <button
              className={category === item ? "active" : ""}
              key={item}
              onClick={() => setCategory(item)}
            >
              {labels[item]}
            </button>
          ))}
        </div>
      </div>
      {feedback && <Notice>{feedback}</Notice>}
      {!tools.length ? (
        <EmptyState
          title="工具目录尚未载入"
          description="请返回总览查看资料校验状态。"
        />
      ) : !shown.length ? (
        <EmptyState
          title="没有匹配的工具"
          description="尝试清除搜索词或选择全部分类。"
        />
      ) : (
        <section className="tool-grid">
          {shown.map((tool) => (
            <article className="panel tool-card" key={tool.id}>
              <div className="tool-card-top">
                <span className="tool-logo">
                  <Boxes size={22} />
                </span>
                <div className="chip-row">
                  <Badge>{labels[tool.category]}</Badge>
                  {tool.version && <Badge tone="accent">v{tool.version}</Badge>}
                </div>
              </div>
              <h3>{tool.name}</h3>
              <p>{tool.summary}</p>
              <div className="platform-row">
                {tool.platforms.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
              <details className="tool-details">
                <summary>安装、使用与许可</summary>
                <h4>安装方法</h4>
                {tool.install.map((line, index) => (
                  <p key={index}>
                    {index + 1}. {line}
                  </p>
                ))}
                <h4>使用说明</h4>
                {tool.usage.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
                <h4>许可与来源</h4>
                <p>{tool.license}</p>
                {tool.downloads.map((link, index) => (
                  <a
                    href={link.url}
                    key={index}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.platform} · {link.notes}
                    <ExternalLink size={12} />
                  </a>
                ))}
                {tool.sources.map((link, index) => (
                  <a
                    href={link.url}
                    key={`source-${index}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.title}
                    <ExternalLink size={12} />
                  </a>
                ))}
              </details>
              <div className="checksum">
                <span>
                  {tool.sha256
                    ? "提供 SHA-256 校验"
                    : "下载来源不代表已实机验证"}
                </span>
              </div>
              <div className="card-actions">
                {tool.homepage && (
                  <a
                    className="button ghost"
                    href={tool.homepage}
                    target="_blank"
                    rel="noreferrer"
                  >
                    官方来源 <ExternalLink size={14} />
                  </a>
                )}
                {supportedAssets.has(tool.id) && (
                  <button
                    className="button secondary"
                    disabled={Boolean(busy)}
                    onClick={() => void getAssets(tool)}
                  >
                    {busy === tool.id ? <Spinner /> : <Download size={14} />}{" "}
                    获取资源
                  </button>
                )}
              </div>
              {tool.id === "android-platform-tools" && (
                <p className="section-help">
                  请先阅读{" "}
                  <a
                    href="https://developer.android.com/studio/terms"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Android SDK 许可条款
                  </a>
                  。独立安装不会覆盖系统版本。
                </p>
              )}
              {tool.id === "android-platform-tools" && (
                <button
                  className="button primary managed-install"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("platform-install", async () => {
                      const statuses =
                        await window.rootDesk.installPlatformTools();
                      await updateSettings({});
                      setFeedback(
                        statuses.every((item) => item.available)
                          ? "官方 Platform Tools 已安装到应用独立目录并验证，ADB 工具箱现在可检测使用。"
                          : statuses
                              .map((item) => item.error)
                              .filter(Boolean)
                              .join("；"),
                      );
                    })
                  }
                >
                  {busy === "platform-install" ? (
                    <Spinner />
                  ) : (
                    <Wrench size={14} />
                  )}{" "}
                  接受 SDK 许可并安装官方工具
                </button>
              )}
              {assets[tool.id] && (
                <div className="asset-list">
                  {assets[tool.id].map((asset) => (
                    <div key={asset.url}>
                      <small>{asset.name}</small>
                      <span>
                        {asset.platform} ·{" "}
                        {asset.sha256 ? "SHA-256 已提供" : "发布者未提供校验值"}
                      </span>
                      <button
                        className="button ghost"
                        disabled={Boolean(busy)}
                        onClick={() => void download(asset)}
                      >
                        下载 <Download size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
