import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@shared/ipc";
import type { RootDeskAPI } from "@shared/contracts";

const api: RootDeskAPI = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getContent: () => ipcRenderer.invoke(IPC.contentGet),
  reloadContent: () => ipcRenderer.invoke(IPC.contentReload),
  searchContent: (query) => ipcRenderer.invoke(IPC.contentSearch, query),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  detectPlatformTools: () => ipcRenderer.invoke(IPC.platformDetect),
  listAdbDevices: () => ipcRenderer.invoke(IPC.adbDevices),
  listFastbootDevices: () => ipcRenderer.invoke(IPC.fastbootDevices),
  previewCommand: (request) => ipcRenderer.invoke(IPC.commandPreview, request),
  executeCommand: (request) => ipcRenderer.invoke(IPC.commandExecute, request),
  cancelCommand: (id) => ipcRenderer.invoke(IPC.commandCancel, id),
  listCommandRuns: () => ipcRenderer.invoke(IPC.commandRuns),
  chooseApk: () => ipcRenderer.invoke(IPC.apkChoose),
  installApk: (request) => ipcRenderer.invoke(IPC.apkInstall, request),
  listDownloads: () => ipcRenderer.invoke(IPC.downloadsList),
  startDownload: (request) => ipcRenderer.invoke(IPC.downloadsStart, request),
  cancelDownload: (id) => ipcRenderer.invoke(IPC.downloadsCancel, id),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.updateStatus),
  checkForUpdates: () => ipcRenderer.invoke(IPC.updateCheck),
  installContentUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  rollbackContent: () => ipcRenderer.invoke(IPC.contentRollback),
  installPlatformTools: () => ipcRenderer.invoke(IPC.platformInstall),
  testProxy: () => ipcRenderer.invoke(IPC.proxyTest),
  revealDownload: (id) => ipcRenderer.invoke(IPC.downloadsReveal, id),
  getToolAssets: (toolId) => ipcRenderer.invoke(IPC.toolAssets, toolId),
  copyText: (text) => ipcRenderer.invoke(IPC.clipboardCopy, text),
};

contextBridge.exposeInMainWorld("rootDesk", Object.freeze(api));
