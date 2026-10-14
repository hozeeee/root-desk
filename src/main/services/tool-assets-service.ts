import { net } from "electron";
import { z } from "zod";
import type { ToolAsset } from "@shared/contracts";

const repositories: Record<string, string> = {
  magisk: "topjohnwu/Magisk",
  "payload-dumper-go": "ssut/payload-dumper-go",
};
const releaseSchema = z.object({
  assets: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        browser_download_url: z.string().url(),
        digest: z.string().nullable().optional(),
      }),
    )
    .max(200),
});

/** Only publisher repositories hardcoded by the application may resolve binaries. */
export async function resolveToolAssets(toolId: string): Promise<ToolAsset[]> {
  if (toolId === "android-platform-tools") {
    return ["windows", "darwin", "linux"].map((platform) => ({
      name: `platform-tools-latest-${platform}.zip`,
      url: `https://dl.google.com/android/repository/platform-tools-latest-${platform}.zip`,
      platform: platform === "darwin" ? "macos" : platform,
    }));
  }
  const repository = repositories[toolId];
  if (!repository) return [];
  const response = await net.fetch(
    `https://api.github.com/repos/${repository}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "RootDesk",
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `官方 GitHub 发布查询失败（HTTP ${response.status}），请检查代理或访问官方发布页`,
    );
  const text = await response.text();
  if (Buffer.byteLength(text) > 1024 * 1024)
    throw new Error("发布信息超出大小限制");
  const release = releaseSchema.parse(JSON.parse(text));
  return release.assets.flatMap((asset): ToolAsset[] => {
    const url = new URL(asset.browser_download_url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(`/${repository}/releases/download/`)
    )
      return [];
    if (toolId === "magisk" && !/^Magisk-v[\w.-]+\.apk$/i.test(asset.name))
      return [];
    if (
      toolId === "payload-dumper-go" &&
      !/\.(?:zip|tar\.gz)$/i.test(asset.name)
    )
      return [];
    const platform =
      toolId === "magisk"
        ? "android"
        : /darwin|macos/i.test(asset.name)
          ? "macos"
          : /windows/i.test(asset.name)
            ? "windows"
            : "linux";
    return [
      {
        name: asset.name,
        url: url.href,
        platform,
        sha256: /^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? "")
          ? asset.digest!.slice(7)
          : undefined,
      },
    ];
  });
}
