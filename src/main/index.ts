import { app, BrowserWindow, dialog } from "electron";
import { createMainWindow } from "./windows/main-window";
import { installSessionHardening } from "./security/hardening";
import { registerIpc } from "./ipc/register-ipc";
import { ContentService } from "./services/content-service";
import { SettingsService } from "./services/settings-service";
import { ProxyService } from "./services/proxy-service";
import { PlatformToolsService } from "./services/platform-tools-service";
import { CommandService } from "./services/command-service";
import { ApkService } from "./services/apk-service";
import { DownloadService } from "./services/download-service";
import { UpdateService } from "./services/update-service";

let disposeIpc: (() => void) | undefined;

app
  .whenReady()
  .then(async () => {
    installSessionHardening();
    const content = new ContentService();
    const settings = new SettingsService();
    await Promise.all([content.load(), settings.load()]);
    const proxy = new ProxyService(settings);
    await proxy
      .apply(settings.get().proxy)
      .catch((error) => console.warn("代理配置应用失败：", error));
    const platformTools = new PlatformToolsService(settings);
    const commands = new CommandService(content, settings, platformTools);
    const apk = new ApkService(commands);
    const downloads = new DownloadService();
    const updates = new UpdateService(content, settings);
    const unregisterIpc = registerIpc({
      content,
      settings,
      proxy,
      platformTools,
      commands,
      apk,
      downloads,
      updates,
    });
    disposeIpc = () => {
      unregisterIpc();
      commands.dispose();
      downloads.dispose();
    };
    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  })
  .catch((error: unknown) => {
    dialog.showErrorBox(
      "RootDesk 启动失败",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  });

app.on("before-quit", () => disposeIpc?.());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
