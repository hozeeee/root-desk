# RootDesk

RootDesk 是面向 Windows 与 macOS 的 Android 解锁 / Root 知识库与安全工具台：按品牌和精确机型整理解锁资格、Root 流程、所需工具、回退方法与来源；提供桌面端与手机端工具目录（介绍、安装、使用、许可）；内置受控的 ADB / Fastboot 工具箱；下载与内容更新统一走可配置代理。

技术栈：Electron 44、electron-vite 5、TypeScript、React、Zod、Vitest、electron-builder。

> 资料为整理与研究用途，**不代表逐型号实机验证**。所有设备状态为 `community` / `research-needed` / `blocked`，`sources.verifiedAt` 均为 `null`，待维护者实机核验后再填写。

## 开发

要求 Node.js 22.12+（CI 使用 Node 24）、npm 10+。

```bash
npm install
npm run dev
```

`predev` / `prebuild` 会运行幂等的 `prepare:electron`（`scripts/prepare-electron.mjs`），在 Electron 运行文件缺失时调用官方安装器补齐。国内网络可先设置系统代理或 `HTTPS_PROXY`。

验证命令：

```bash
npm run typecheck     # tsc --noEmit
npm test              # Vitest，全部单元与安全回归测试
npm run build         # electron-vite 构建到 out/
npm run smoke         # 真实 Electron 冒烟：安全配置、具名 IPC、9 品牌 63 机型、六页导航、深浅色截图（.smoke/）
npm run test:services # 仅网络 / 下载 / 更新 / 代理 / 平台工具服务测试
npm run test:tools    # 可选：真实下载并安装官方 Platform Tools 到临时目录（需联网）
```

打包：`npm run package:mac`、`npm run package:win`（electron-builder，`seed-content` 作为 extraResources 随包分发）。CI 见 `.github/workflows/ci.yml`（macOS + Windows 矩阵：typecheck、test、build、macOS smoke、未签名打包）。

## 目录结构

```
src/
  main/
    index.ts              仅装配服务、IPC、窗口与生命周期
    windows/              BrowserWindow 创建（sandbox、contextIsolation、CSP、导航拦截）
    ipc/register-ipc.ts   全部 IPC handler：校验 sender + Zod 参数后转交服务
    services/             业务服务（见下表）
    security/             策略与校验：命令策略、sender、URL/路径、压缩包、隔离区、内容存储
  preload/index.ts        CommonJS 白名单桥接，只暴露具名 window.rootDesk 方法
  shared/                 跨进程契约：IPC 通道、类型、Zod schema、设置校验
  renderer/
    app/                  AppShell、导航、全局状态
    features/             dashboard / guides / tools / adb / downloads / settings 六个页面
    components/ styles/   复用组件与深浅色 CSS 变量
resources/seed-content/   随包内容：catalog.json、tools.json、commands.json、manifest.json
scripts/                  Electron 准备、冒烟、内容清单生成与签名
tests/                    Vitest 测试
```

| 服务 | 职责 |
| --- | --- |
| `content-service` | 读取 seed / 已激活更新内容，Zod 校验，搜索，回滚指针 |
| `update-service` | GitHub Releases 检查、Ed25519 签名验证、逐文件 SHA-256 / 字节校验、暂存后原子切换 |
| `settings-service` | 设置持久化（原子写入，0600）；专家模式每次启动强制关闭 |
| `proxy-service` | 系统代理 / 自定义 HTTP、HTTPS、SOCKS5，凭证仅存内存，`test()` 连通性测试 |
| `download-service` | 下载任务、并发与大小上限、SHA-256 校验、不覆盖已有文件；失败的 `.part` 移入隔离区或废纸篓 |
| `platform-tools-service` | 检测 adb/fastboot；接受许可后从 `dl.google.com` 下载官方 zip 安全解压并设置路径 |
| `tool-assets-service` | 仅从硬编码发布方（Google、topjohnwu/Magisk、ssut/payload-dumper-go）解析资源地址 |
| `command-service` | 设备列表、命令预览与执行、设备锁、取消、审计日志 |
| `apk-service` | APK 选择与安装（需选定设备并二次确认） |

## 内容维护

- `catalog.json`：品牌 → 设备（代号、型号变体、芯片、Android 样本版本、解锁资格、Root 方法、步骤、风险、回退、来源）。
- `tools.json`：工具（平台、类别、介绍、安装、使用、许可、是否可再分发、下载与来源链接）。
- `commands.json`：命令模板（类型、风险、`deviceModes`、参数定义）。**只随应用发布，远程更新永远不会替换它**。
- `manifest.json`：上述文件的 SHA-256 与字节数；修改内容后需重新计算。

`tests/content-schema.test.ts` 会校验品牌 / 机型数量、ID 唯一、工具引用有效、步骤与来源非空等不变量。步骤中的命令只是可复制的资料文本，不会被自动执行。

## 远程内容更新（GitHub Releases）

1. 在设置 → 资料更新中填写内容仓库 `owner/repo` 与 Ed25519 公钥 PEM（也可用环境变量 `ROOTDESK_CONTENT_REPOSITORY`）。
2. 维护者本地生成并签名清单（输入输出必须位于项目内，输出不覆盖已有文件）：

```bash
openssl genpkey -algorithm ed25519 -out rootdesk-content.key   # 私钥切勿提交或打包
openssl pkey -in rootdesk-content.key -pubout                   # 公钥粘贴到设置
npm run content:manifest -- owner/repo 1.1.0 <content-dir> unsigned.json
npm run content:sign -- unsigned.json rootdesk-content.key rootdesk-manifest.json
```

3. 新建 tag 为该版本的 Release，上传 `catalog.json`、`tools.json`、`rootdesk-manifest.json`。

客户端只接受同仓库、同版本的 Release 资产 URL，签名载荷为 `JSON.stringify({ schemaVersion, version, files })`。验证通过后写入暂存目录、再原子切换激活指针；可在设置中回滚到随包内容。

## 安全边界

- Renderer：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、严格 CSP，无 webview；每个 IPC 校验来源为主框架可信页面。
- 命令：`spawn(exe, args, { shell: false })`；普通模式只运行目录命令，危险命令与自由命令需专家模式（仅当前会话有效）。
- 预览令牌：一次性、60 秒有效，绑定完整 argv、序列号、参数、文件哈希和专家模式；执行前重新列设备并核对 adb/fastboot 模式。
- 除 `devices` / `version` / 帮助外，所有命令必须绑定序列号（自动注入 `-s`），拒绝 `-s/-t/-d/-e/-H/-P/-L`、remote/connect/forward、shell 元字符与 `flashall`。
- 高风险操作需输入确认词 `我已了解风险 <序列号>`；审计日志写入 `userData/audit` 并脱敏。
- 代理：HTTP(S) 认证凭证只在主进程内存；Chromium 不支持带认证的 SOCKS5，会明确拒绝。
- 文件：下载不覆盖已有文件，残留文件只移入隔离区 / 废纸篓，不做永久删除。

## 已知限制

- 资料未经实机验证；Windows 包仅由 CI 构建验证。
- 发布前需配置代码签名 / macOS 公证、内容仓库与公钥。
- 下载任务仅保存在当前会话，不支持跨重启断点续传。
- `npm audit` 有 8 个 moderate 级别告警，来自 electron-builder 的依赖链（仅构建期）。
