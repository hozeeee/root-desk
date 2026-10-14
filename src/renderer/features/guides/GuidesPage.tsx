import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  Cpu,
  ExternalLink,
  RotateCcw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useApp } from "../../app/AppContext";
import { PageHeader } from "../../components/PageHeader";
import { Badge, EmptyState, Notice } from "../../components/Ui";

const statusLabels = {
  verified: "有文档核验记录",
  community: "社区流程 · 未实机验证",
  "research-needed": "需要进一步调研",
  blocked: "受限 / 暂不可用",
};
const risks = {
  low: "查询 / 低风险",
  medium: "注意",
  high: "高风险",
  critical: "可能清数据或变砖",
};

export function GuidesPage({ focusId }: { focusId?: string }): JSX.Element {
  const { content } = useApp();
  const brands = content?.catalog?.brands ?? [];
  const [brandId, setBrandId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const keyword = filter.trim().toLowerCase();
  const tree = useMemo(
    () =>
      brands
        .map((item) => ({
          brand: item,
          devices:
            !keyword || item.name.toLowerCase().includes(keyword)
              ? item.devices
              : item.devices.filter((entry) =>
                  [entry.name, ...entry.codenames, ...entry.variants].some(
                    (text) => text.toLowerCase().includes(keyword),
                  ),
                ),
        }))
        .filter((node) => node.devices.length),
    [brands, keyword],
  );
  useEffect(() => {
    const targetBrand = brands.find(
      (item) =>
        item.id === focusId ||
        item.devices.some((device) => device.id === focusId),
    );
    if (targetBrand) {
      setBrandId(targetBrand.id);
      setDeviceId(focusId ?? "");
    }
  }, [focusId, content]);
  const brand = brands.find((item) => item.id === brandId) ?? brands[0];
  const device = useMemo(
    () =>
      brand?.devices.find((item) => item.id === deviceId) ?? brand?.devices[0],
    [brand, deviceId],
  );
  const completedCount =
    device?.steps.filter((step) => completed[`${device.id}:${step.id}`])
      .length ?? 0;
  const deviceTools = (content?.tools?.tools ?? []).filter((tool) =>
    device?.tools.includes(tool.id),
  );
  const copy = async (command: string): Promise<void> => {
    try {
      await window.rootDesk.copyText(command);
      setCopied(command);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="DEVICE LIBRARY"
        title="设备指南"
        description="按精确型号和变体阅读流程；营销名相同不代表固件、解锁资格和启动分区相同。"
      />
      {error && <Notice danger>{error}</Notice>}
      {!brands.length ? (
        <EmptyState
          title="设备资料未载入"
          description="请返回总览查看校验结果，或重新载入本地资料。"
        />
      ) : (
        <div className="guide-layout">
          <aside className="guide-index panel">
            <div className="tree-filter">
              <Search size={14} />
              <input
                value={filter}
                placeholder="筛选品牌、机型或代号…"
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <div className="device-tree" role="tree" aria-label="品牌与机型">
              {tree.map(({ brand: item, devices }) => {
                const open = keyword ? true : (expanded[item.id] ?? item.id === brand?.id);
                return (
                  <div key={item.id} role="treeitem" aria-expanded={open}>
                    <button
                      className={`tree-brand ${item.id === brand?.id ? "current" : ""}`}
                      onClick={() =>
                        setExpanded((current) => ({ ...current, [item.id]: !open }))
                      }
                    >
                      <ChevronRight
                        size={15}
                        className={open ? "tree-chevron open" : "tree-chevron"}
                      />
                      <strong>{item.name}</strong>
                      <span>{devices.length}</span>
                    </button>
                    {open && (
                      <div className="tree-children" role="group">
                        {devices.map((entry) => (
                          <button
                            role="treeitem"
                            aria-selected={entry.id === device?.id}
                            className={entry.id === device?.id ? "active" : ""}
                            key={entry.id}
                            onClick={() => {
                              setBrandId(item.id);
                              setDeviceId(entry.id);
                            }}
                          >
                            <i
                              className={`tree-status status-${entry.root.status}`}
                              title={statusLabels[entry.root.status]}
                            />
                            <span>
                              <strong>{entry.name}</strong>
                              <small>{entry.codenames.join(" / ")}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {!tree.length && <p className="tree-empty">没有匹配的机型</p>}
            </div>
            <div className="tree-legend">
              <span>
                <i className="tree-status status-community" />
                社区流程
              </span>
              <span>
                <i className="tree-status status-research-needed" />
                待调研
              </span>
              <span>
                <i className="tree-status status-blocked" />
                受限
              </span>
            </div>
          </aside>
          {device && (
            <article className="guide-detail">
              <section className="panel device-hero">
                <div>
                  <div className="chip-row">
                    <Badge tone="accent">{brand?.name}</Badge>
                    {device.androidVersions.map((version) => (
                      <Badge key={version}>
                        {version.startsWith("Android")
                          ? version
                          : `Android ${version}`}
                      </Badge>
                    ))}
                  </div>
                  <h2>{device.name}</h2>
                  <p>
                    {device.codenames.join(" / ")} ·{" "}
                    {device.variants.join(" · ")}
                  </p>
                </div>
                <div className="device-spec">
                  <Cpu size={19} />
                  <span>
                    <small>芯片平台</small>
                    <strong>{device.soc}</strong>
                  </span>
                </div>
              </section>
              {device.warning && <Notice danger>{device.warning}</Notice>}
              <section className="detail-grid">
                <div className="panel info-card">
                  <span className="eyebrow">BOOTLOADER</span>
                  <h3>
                    {device.bootloader.unlockable
                      ? "可能具备解锁资格"
                      : "资格受限 / 待确认"}
                  </h3>
                  <p>{device.bootloader.method}</p>
                  {device.bootloader.notes.map((note) => (
                    <small key={note}>{note}</small>
                  ))}
                </div>
                <div className="panel info-card">
                  <span className="eyebrow">RESEARCH STATUS</span>
                  <h3>{statusLabels[device.root.status]}</h3>
                  <p>{device.root.methods.join(" · ") || "等待资料"}</p>
                  {device.root.notes.map((note) => (
                    <small key={note}>{note}</small>
                  ))}
                </div>
              </section>
              <section className="panel steps-panel">
                <div className="panel-heading">
                  <h3>操作前检查</h3>
                  <Badge>{device.prerequisites.length} 项</Badge>
                </div>
                <ul className="prerequisite-list">
                  {device.prerequisites.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
              <section className="panel steps-panel">
                <div className="panel-heading">
                  <h3>需要准备的工具</h3>
                  <Badge>{deviceTools.length} 项</Badge>
                </div>
                {deviceTools.map((tool) => (
                  <details className="tool-details" key={tool.id}>
                    <summary>
                      {tool.name} · {tool.platforms.join(" / ")}
                    </summary>
                    <p>{tool.summary}</p>
                    <h4>安装方法</h4>
                    {tool.install.map((text, index) => (
                      <p key={index}>{text}</p>
                    ))}
                    <h4>使用说明</h4>
                    {tool.usage.map((text, index) => (
                      <p key={index}>{text}</p>
                    ))}
                    {tool.homepage && (
                      <a href={tool.homepage} target="_blank" rel="noreferrer">
                        官方来源
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </details>
                ))}
              </section>
              <section className="panel guide-progress">
                <div className="panel-heading">
                  <h3>当前阅读进度</h3>
                  <Badge tone="accent">
                    {completedCount} / {device.steps.length}
                  </Badge>
                </div>
                <progress
                  className="progress"
                  max={device.steps.length || 1}
                  value={completedCount}
                />
                <p>
                  勾选只记录本次阅读，不会连接设备、执行命令或判定 Root
                  成功。离开此页后重置。
                </p>
              </section>
              <section className="panel steps-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">PROCEDURE</span>
                    <h3>操作流程</h3>
                  </div>
                  <Badge>{device.steps.length} 步</Badge>
                </div>
                <ol className="steps-list">
                  {device.steps.map((step, index) => (
                    <li key={step.id}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <div className="step-heading">
                          <h4>{step.title}</h4>
                          {step.risk && (
                            <Badge
                              tone={
                                ["high", "critical"].includes(step.risk)
                                  ? "danger"
                                  : step.risk === "medium"
                                    ? "warning"
                                    : "success"
                              }
                            >
                              {risks[step.risk]}
                            </Badge>
                          )}
                        </div>
                        <p>{step.description}</p>
                        {step.commands.length > 0 && (
                          <div className="command-pills">
                            {step.commands.map((command) => (
                              <code className="copy-command" key={command}>
                                {command}
                                <button
                                  title="仅复制，不执行"
                                  onClick={() => void copy(command)}
                                >
                                  {copied === command ? (
                                    <Check size={12} />
                                  ) : (
                                    <Copy size={12} />
                                  )}
                                </button>
                              </code>
                            ))}
                          </div>
                        )}
                        {step.warnings.map((warning) => (
                          <small className="warning-text" key={warning}>
                            <ShieldAlert size={13} />
                            {warning}
                          </small>
                        ))}
                        <label className="step-check">
                          <input
                            type="checkbox"
                            checked={Boolean(
                              completed[`${device.id}:${step.id}`],
                            )}
                            onChange={(event) =>
                              setCompleted({
                                ...completed,
                                [`${device.id}:${step.id}`]:
                                  event.target.checked,
                              })
                            }
                          />
                          我已阅读并自行核对此步骤
                        </label>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
              <section className="panel steps-panel">
                <div className="panel-heading">
                  <h3>
                    <RotateCcw size={16} /> 恢复与回退
                  </h3>
                </div>
                {device.rollback.length ? (
                  <ol className="steps-list">
                    {device.rollback.map((step, index) => (
                      <li key={`${device.id}-${index}`}>
                        <span>{index + 1}</span>
                        <div>
                          <h4>{step.title}</h4>
                          <p>{step.description}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>该设备暂无结构化恢复资料，不能据此执行刷写。</p>
                )}
              </section>
              <section className="sources">
                <span>参考来源（不代表逐型号实机验证）</span>
                {device.sources.map((source) => (
                  <a
                    key={source.url}
                    href={source.url}
                    title={
                      source.verifiedAt
                        ? `资料维护记录：${source.verifiedAt}`
                        : "未完成链接复核"
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.title} ·{" "}
                    {source.kind === "official"
                      ? "官方"
                      : source.kind === "project"
                        ? "项目"
                        : "社区"}
                    <ExternalLink size={13} />
                  </a>
                ))}
              </section>
            </article>
          )}
        </div>
      )}
    </div>
  );
}
