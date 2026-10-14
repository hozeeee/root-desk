import { useEffect, useState } from "react";
import {
  Download,
  FileCheck2,
  FolderOpen,
  Link,
  RefreshCw,
  Square,
  XCircle,
} from "lucide-react";
import type { DownloadTask } from "@shared/contracts";
import { PageHeader } from "../../components/PageHeader";
import { Badge, EmptyState, Notice } from "../../components/Ui";

export function DownloadsPage(): JSX.Element {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [url, setUrl] = useState("");
  const [sha256, setSha256] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = (): Promise<void> =>
    window.rootDesk.listDownloads().then(setTasks);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 1000);
    return () => clearInterval(timer);
  }, []);
  const start = async (): Promise<void> => {
    setError(null);
    try {
      await window.rootDesk.startDownload({ url, sha256: sha256 || undefined });
      setUrl("");
      setSha256("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="VERIFIED TRANSFERS"
        title="下载中心"
        description="通过 HTTPS 获取工具，并在写入完成后执行 SHA-256 完整性校验。"
        actions={
          <button className="button secondary" onClick={() => void load()}>
            <RefreshCw size={16} /> 刷新
          </button>
        }
      />
      {error && <Notice danger>{error}</Notice>}
      <Notice>
        代理可在设置中配置。未提供发布者校验值的任务不会显示为“已验证”；下载不自动运行。任务记录仅保留本次会话，完成文件保存在“下载
        / RootDesk”。
      </Notice>
      <section className="panel download-form">
        <div className="form-icon">
          <Download size={24} />
        </div>
        <div className="download-fields">
          <label className="field">
            <span>下载地址（仅 HTTPS）</span>
            <div className="input-with-icon">
              <Link size={16} />
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/platform-tools.zip"
              />
            </div>
          </label>
          <label className="field">
            <span>SHA-256（可选）</span>
            <input
              value={sha256}
              onChange={(event) => setSha256(event.target.value)}
              placeholder="64 位十六进制校验值"
            />
          </label>
        </div>
        <button
          className="button primary"
          disabled={!url}
          onClick={() => void start()}
        >
          创建任务
        </button>
      </section>
      {!tasks.length ? (
        <EmptyState
          title="还没有下载任务"
          description="从工具目录发起下载，或在上方粘贴经过信任的 HTTPS 地址。"
        />
      ) : (
        <section className="task-list">
          {tasks.map((task) => {
            const progress = task.totalBytes
              ? Math.min(100, (task.receivedBytes / task.totalBytes) * 100)
              : 0;
            return (
              <article className="panel task-row" key={task.id}>
                <span className={`task-icon status-${task.status}`}>
                  {task.status === "completed" ? (
                    <FileCheck2 size={20} />
                  ) : task.status === "failed" ? (
                    <XCircle size={20} />
                  ) : (
                    <Download size={20} />
                  )}
                </span>
                <div className="task-main">
                  <div>
                    <strong>{task.fileName}</strong>
                    <Badge
                      tone={
                        task.status === "completed"
                          ? "success"
                          : task.status === "failed"
                            ? "danger"
                            : "accent"
                      }
                    >
                      {
                        {
                          queued: "排队中",
                          downloading: "下载中",
                          verifying: "校验中",
                          completed: "已完成",
                          failed: "失败",
                          cancelled: "已取消",
                        }[task.status]
                      }
                    </Badge>
                  </div>
                  <small>
                    {formatBytes(task.receivedBytes)}
                    {task.totalBytes
                      ? ` / ${formatBytes(task.totalBytes)}`
                      : ""}
                  </small>
                  <progress
                    className="progress"
                    max={100}
                    value={task.status === "completed" ? 100 : progress}
                  />
                  {task.status === "completed" && (
                    <span>
                      {task.expectedSha256
                        ? "SHA-256 校验通过"
                        : "下载完成，未提供校验值"}
                    </span>
                  )}
                  {task.error && (
                    <span className="danger-text">{task.error}</span>
                  )}
                </div>
                {task.status === "completed" && (
                  <button
                    className="button ghost"
                    onClick={() =>
                      void window.rootDesk
                        .revealDownload(task.id)
                        .catch((reason) =>
                          setError(
                            reason instanceof Error
                              ? reason.message
                              : String(reason),
                          ),
                        )
                    }
                  >
                    <FolderOpen size={14} />
                    定位文件
                  </button>
                )}
                {task.status === "failed" && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      void window.rootDesk
                        .startDownload({
                          url: task.url,
                          fileName: task.fileName,
                          sha256: task.expectedSha256,
                        })
                        .then(load)
                        .catch((reason) =>
                          setError(
                            reason instanceof Error
                              ? reason.message
                              : String(reason),
                          ),
                        )
                    }
                  >
                    重试
                  </button>
                )}
                {["queued", "downloading", "verifying"].includes(
                  task.status,
                ) && (
                  <button
                    className="icon-button"
                    onClick={() => void window.rootDesk.cancelDownload(task.id)}
                  >
                    <Square size={16} />
                  </button>
                )}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
