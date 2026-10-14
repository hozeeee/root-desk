import type {
  Catalog,
  CommandDefinition,
  CommandsDocument,
  ToolDefinition,
  ToolsDocument,
} from "./schemas";

export type ThemeMode = "dark" | "light" | "system";
export type ProxyMode = "system" | "custom";
export type ProxyProtocol = "http" | "https" | "socks5";

export interface ProxySettings {
  mode: ProxyMode;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
  hasCredential?: boolean;
}

export interface AppSettings {
  theme: ThemeMode;
  expertMode: boolean;
  platformToolsPath?: string;
  contentRepository?: string;
  contentPublicKey?: string;
  proxy: ProxySettings;
}

export interface ContentIssue {
  file: string;
  message: string;
}
export interface ContentSnapshot {
  catalog: Catalog | null;
  tools: ToolsDocument | null;
  commands: CommandsDocument | null;
  issues: ContentIssue[];
  loadedAt: string;
}

export interface SearchResult {
  kind: "brand" | "device" | "tool" | "command";
  id: string;
  title: string;
  subtitle: string;
  score: number;
}

export interface BinaryStatus {
  name: "adb" | "fastboot";
  available: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export interface ConnectedDevice {
  serial: string;
  state: string;
  product?: string;
  model?: string;
  device?: string;
  transportId?: string;
}

export interface CommandSpec {
  executable: "adb" | "fastboot";
  args: string[];
}
export interface CommandPreview {
  allowed: boolean;
  display: string;
  source: "catalog" | "expert";
  command?: CommandDefinition;
  requiresConfirmation: boolean;
  confirmationWord?: string;
  reason?: string;
  token?: string;
  spec?: CommandSpec;
  serial?: string;
}

export interface CommandRequest {
  commandId?: string;
  expert?: CommandSpec;
  parameters?: Record<string, string>;
  serial?: string;
  confirmation?: string;
  previewToken?: string;
}

export interface CommandRun {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  executable: string;
  args: string[];
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface DownloadTask {
  id: string;
  url: string;
  fileName: string;
  destination: string;
  expectedSha256?: string;
  receivedBytes: number;
  totalBytes?: number;
  status:
    | "queued"
    | "downloading"
    | "verifying"
    | "completed"
    | "failed"
    | "cancelled";
  error?: string;
  createdAt: string;
}

export interface UpdateStatus {
  state:
    | "not-configured"
    | "idle"
    | "checking"
    | "available"
    | "up-to-date"
    | "installing"
    | "installed"
    | "error";
  message: string;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
}

export interface ApkSelection {
  canceled: boolean;
  filePath?: string;
  fileName?: string;
  size?: number;
}
export interface ApkInstallRequest {
  filePath: string;
  serial: string;
  replace?: boolean;
  allowDowngrade?: boolean;
  grantPermissions?: boolean;
  confirmation?: string;
}
export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
}
export interface ToolAsset {
  name: string;
  url: string;
  platform: string;
  sha256?: string;
}

export interface RootDeskAPI {
  getAppInfo(): Promise<AppInfo>;
  getContent(): Promise<ContentSnapshot>;
  reloadContent(): Promise<ContentSnapshot>;
  searchContent(query: string): Promise<SearchResult[]>;
  getSettings(): Promise<AppSettings>;
  updateSettings(
    patch: Partial<AppSettings> & { proxyPassword?: string },
  ): Promise<AppSettings>;
  detectPlatformTools(): Promise<BinaryStatus[]>;
  listAdbDevices(): Promise<ConnectedDevice[]>;
  listFastbootDevices(): Promise<ConnectedDevice[]>;
  previewCommand(request: CommandRequest): Promise<CommandPreview>;
  executeCommand(request: CommandRequest): Promise<CommandRun>;
  cancelCommand(id: string): Promise<boolean>;
  listCommandRuns(): Promise<CommandRun[]>;
  chooseApk(): Promise<ApkSelection>;
  installApk(request: ApkInstallRequest): Promise<CommandRun>;
  listDownloads(): Promise<DownloadTask[]>;
  startDownload(request: {
    url: string;
    fileName?: string;
    sha256?: string;
  }): Promise<DownloadTask>;
  cancelDownload(id: string): Promise<boolean>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installContentUpdate(): Promise<UpdateStatus>;
  rollbackContent(): Promise<ContentSnapshot>;
  installPlatformTools(): Promise<BinaryStatus[]>;
  testProxy(): Promise<{
    ok: boolean;
    message: string;
    resolvedProxy: string;
    latencyMs: number;
  }>;
  revealDownload(id: string): Promise<boolean>;
  getToolAssets(toolId: string): Promise<ToolAsset[]>;
  copyText(text: string): Promise<void>;
}

export type { Catalog, ToolDefinition, CommandDefinition };
