import { app, clipboard, ipcMain } from "electron";
import { z } from "zod";
import { IPC } from "@shared/ipc";
import { settingsPatchSchema } from "@shared/settings";
import { assertTrustedSender } from "@main/security/sender";
import type { ContentService } from "@main/services/content-service";
import type { SettingsService } from "@main/services/settings-service";
import type { ProxyService } from "@main/services/proxy-service";
import type { PlatformToolsService } from "@main/services/platform-tools-service";
import type { CommandService } from "@main/services/command-service";
import type { ApkService } from "@main/services/apk-service";
import type { DownloadService } from "@main/services/download-service";
import type { UpdateService } from "@main/services/update-service";
import { resolveToolAssets } from "@main/services/tool-assets-service";

interface Services {
  content: ContentService;
  settings: SettingsService;
  proxy: ProxyService;
  platformTools: PlatformToolsService;
  commands: CommandService;
  apk: ApkService;
  downloads: DownloadService;
  updates: UpdateService;
}

const commandRequestSchema = z
  .object({
    commandId: z.string().max(128).optional(),
    expert: z
      .object({
        executable: z.enum(["adb", "fastboot"]),
        args: z.array(z.string().max(4096)).max(128),
      })
      .strict()
      .optional(),
    confirmation: z.string().max(256).optional(),
    serial: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9._:-]+$/)
      .optional(),
    parameters: z.record(z.string().max(8192)).optional(),
    previewToken: z.string().max(256).optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.commandId) !== Boolean(value.expert),
    "目录命令和专家命令必须且只能选择一种",
  );
const downloadSchema = z
  .object({
    url: z.string().max(4096),
    fileName: z.string().max(255).optional(),
    sha256: z.string().max(64).optional(),
  })
  .strict();
const apkSchema = z
  .object({
    filePath: z.string().max(8192),
    serial: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    confirmation: z.string().max(256).optional(),
    replace: z.boolean().optional(),
    allowDowngrade: z.boolean().optional(),
    grantPermissions: z.boolean().optional(),
  })
  .strict();

export function registerIpc(services: Services): () => void {
  const channels: string[] = [];
  const handle = (
    channel: string,
    listener: (
      event: Electron.IpcMainInvokeEvent,
      ...args: unknown[]
    ) => unknown,
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event);
      return listener(event, ...args);
    });
    channels.push(channel);
  };

  handle(IPC.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  }));
  handle(IPC.contentGet, () => services.content.getSnapshot());
  handle(IPC.contentReload, () => services.content.load());
  handle(IPC.contentSearch, (_event, query) =>
    services.content.search(z.string().max(200).parse(query)),
  );
  handle(IPC.settingsGet, () => services.settings.get());
  handle(IPC.settingsUpdate, (_event, patch) =>
    services.proxy.update(settingsPatchSchema.parse(patch)),
  );
  handle(IPC.platformDetect, () => services.platformTools.detect());
  handle(IPC.adbDevices, () => services.platformTools.listAdbDevices());
  handle(IPC.fastbootDevices, () =>
    services.platformTools.listFastbootDevices(),
  );
  handle(IPC.commandPreview, (_event, request) =>
    services.commands.preview(commandRequestSchema.parse(request)),
  );
  handle(IPC.commandExecute, (_event, request) =>
    services.commands.execute(commandRequestSchema.parse(request)),
  );
  handle(IPC.commandCancel, (_event, id) =>
    services.commands.cancel(z.string().uuid().parse(id)),
  );
  handle(IPC.commandRuns, () => services.commands.list());
  handle(IPC.apkChoose, () => services.apk.choose());
  handle(IPC.apkInstall, (_event, request) =>
    services.apk.install(apkSchema.parse(request)),
  );
  handle(IPC.downloadsList, () => services.downloads.list());
  handle(IPC.downloadsStart, (_event, request) =>
    services.downloads.start(downloadSchema.parse(request)),
  );
  handle(IPC.downloadsCancel, (_event, id) =>
    services.downloads.cancel(z.string().uuid().parse(id)),
  );
  handle(IPC.updateStatus, () => services.updates.getStatus());
  handle(IPC.updateCheck, () => services.updates.check());
  handle(IPC.updateInstall, () => services.updates.install());
  handle(IPC.contentRollback, () => services.content.rollback());
  handle(IPC.platformInstall, () => services.platformTools.install());
  handle(IPC.proxyTest, () => services.proxy.test());
  handle(IPC.downloadsReveal, (_event, id) =>
    services.downloads.reveal(z.string().uuid().parse(id)),
  );
  handle(IPC.toolAssets, (_event, id) =>
    resolveToolAssets(z.string().max(100).parse(id)),
  );
  handle(IPC.clipboardCopy, (_event, text) =>
    clipboard.writeText(z.string().max(20_000).parse(text)),
  );

  return () => channels.forEach((channel) => ipcMain.removeHandler(channel));
}
