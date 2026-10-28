# dsh-task-toast

> 一个 **任务完成提示浮层** 插件，适用于
> [DeepSeek Harness](https://www.deepseek.com/harness/)（`dsh`）。

[English documentation](./README.md)

当 dsh 内的任务完成时，会弹出一张**独立的置顶小卡片**（或应用内浮层），提供
**查看结果 / 稍后 / 忽略** 三个操作。
卡片的停靠角落（四角任选）、界面语言（中文 / 英文），以及点击「查看结果」的行为
（跳转到会话 / 浮层内展开）都可在设置面板中配置。

---

## 功能特性

- **四角停靠** —— 左上 / 右上 / 左下 / 右下，默认 **右下角**。
- **三按钮浮层** —— `查看结果` / `稍后` / `忽略`，外加常驻关闭按钮；每张卡片按配置延时自动消失。
- **可配置的点击行为**
  - `跳转到会话`（默认）：点击「查看结果」直接跳到对应会话。
  - `浮层内展开内容`：点击「查看结果」在原浮层内展开结果摘要（并显示「复制结果」按钮）。
- **双语界面** —— 中文（简体）/ English；浮层与设置面板的全部文案，
  以及 Host 端生成的标题/正文，均跟随同一语言设置。
- **Apple 风毛玻璃** —— 半透明磨砂质感，使用 `backdrop-filter: blur + saturate`、
  柔和分层阴影与弹性滑入动画，取代原本偏「AI 感」的扁平样式。所有颜色均带
  显式兜底，即便 dsh 的 CSS 变量缺失也不会出现空白按钮。
- **自适应主题** —— `跟随系统`（依据 `prefers-color-scheme`）/ `浅色` / `深色`，
  另提供「跟随 dsh 皮肤主题色」开关，用 dsh 自身的 `--dsw-alias-brand-primary`
  为主按钮着色。
- **广泛的完成事件覆盖** —— 子代理结束、后台任务完成、工作流子任务结束、
  以及顶层会话 `running → idle` 切换。
- **跨应用置顶（两种形态）**
  - `独立置顶小卡片`（默认）：创建一个**脱离 dsh 的无边框浮窗**，只占屏幕一角，
    真·`TopMost` 压在所有应用之上，窗口本身带亚克力模糊 / 圆角 / 阴影，
    **不抢焦点**——你可以继续在别的应用里打字。多张卡片会自动竖向堆叠。
  - `提升 dsh 窗口`：把整个 dsh 主窗口抬到最上层（旧行为），适合希望顺手切回 dsh 的场景。
  - 两者都仅 Windows 桌面客户端可用，网页 / CLI 模式自动跳过。
- **内置更新提醒** —— Host 在启动 8 秒后及此后每 6 小时查询上游 GitHub Release
  （可开关）。发现新版本时弹出带「更新」按钮的通知；设置页提供
  **立即检查 / 复制更新命令 / 一键更新**（由 Host 代跑 `dsh plugin remove` + `add`），
  不必再手动卸载重装。
- **不改动 dsh 源码** —— 通过 Host 暴露的 HTTP 通道通信，借助 dsh 公开 slot 渲染，
  可随 dsh 升级平滑过渡。

## 架构

dsh 插件遵循 **Host + Client（宿主 + 客户端）** 分离结构。本插件以
**静态包（static bundle）** 形式发布（即 `dsh plugin add github:` 所消费的形态）：

```
                ┌──────────────────────────────────────────┐
   领域事件  ──►│  Host  (lib/index.js, Node 主进程)         │
                │  • 订阅 Cordis 任务完成事件                  │
                │  • 将通知入队                               │
                │  • 暴露 /dsh-task-toast HTTP 通道           │
                └───────────────┬──────────────────────────┘
                                │  HTTP 长轮询 + 配置
                ┌───────────────▼──────────────────────────┐
   浮层+设置 ──│  Client (lib/client.js, WebView 运行时)     │
                │  • 长轮询 Host 通道                        │
                │  • 在 `shell.overlay` 渲染浮层             │
                │  • 在 `settings.section` 渲染设置面板       │
                └───────────────────────────────────────────┘
```

| 半体 | 文件（源码 → 产物） | 运行时 | 职责 |
| --- | --- | --- | --- |
| Host | `src/static/host.js` → `lib/index.js` | Node | 事件订阅、入队、HTTP 通道（`state` / `config` / `poll` / `test` / `active` / `version` / `check-update` / `update` / `topmost` / `card` / `card-action`）、上游版本轮询、卡片 spawn 与窗口置顶。 |
| Client | `src/static/client.js` → `lib/client.js` | WebView | 长轮询消费、浮层 UI、设置面板、更新面板。通过 `window.__ModuleLoader__` 注入。 |
| Card | `scripts/card.ps1` | WinForms | 独立的无边框置顶卡片（亚克力模糊 + 圆角 + 三按钮），按钮结果回传 Host。 |

### 独立卡片是怎么做到的

dsh 有两种形态：**Electron 桌面客户端**（`D:\...\DeepSeek Harness.exe`，Electron 44）
和纯 **web / CLI** 模式。插件代码本身跑在 *Node 模式* 子进程里
（`ELECTRON_RUN_AS_NODE=1`），**拿不到 `BrowserWindow`** —— 所以插件无法在进程内
创建原生窗口。于是改为 **spawn 一个独立的 PowerShell + WinForms 进程**：

```
通知到达 ──► Host (Node)
              └─ spawn powershell -STA -File scripts/card.ps1 -Title … -Position …
                   ├─ SetWindowCompositionAttribute(ACCENT_ENABLE_ACRYLICBLURBEHIND)  ← 亚克力模糊
                   ├─ DwmSetWindowAttribute(WINDOW_CORNER_PREFERENCE = ROUND)         ← Win11 圆角
                   ├─ FormBorderStyle=None + TopMost=true                            ← 无边框、真置顶
                   └─ 按钮点击 → POST /dsh-task-toast/card-action {id, action}
                        ├─ view   → 页面跳转到会话 + 把 dsh 窗口顶到前面
                        ├─ later  → 5 分钟后重新提醒
                        └─ ignore → 丢弃
```

- 卡片窗口按 `process.ppid` 之外的独立进程创建，**与 dsh 窗口互不影响**：
  dsh 最小化、被遮挡，卡片照样可见。
- 多张卡片按 `-Slot` 竖向堆叠（右下角时自下而上），互不重叠。
- **卡片不可用时自动回退**：脚本缺失、PowerShell 被策略拦截、编译失败等情况下，
  Host 会在 4 秒内检测到子进程异常退出，改为「提升 dsh 窗口」，保证通知不会丢。
- 选 `提升 dsh 窗口` 时走 `scripts/topmost.ps1`：`EnumWindows` 按 `process.ppid`
  定位 Electron 主窗口（找不到则按标题兜底 `matchTitle`），再
  `SetWindowPos(hwnd, HWND_TOPMOST)`，同样不抢焦点（`SWP_NOACTIVATE`）。
- **仅 Windows**（依赖 `user32.dll` / `dwmapi.dll`）。macOS / Linux 上自动跳过。

> 说明：卡片是原生 WinForms 窗口，用 DWM 亚克力 + 圆角模拟毛玻璃观感，
> 与 macOS 的 `backdrop-filter` 不是同一套效果；应用内浮层仍保留完整毛玻璃。

`package.json` 同时声明了 `dsh.bundle.patch`（经 `cordis.patch.yml` 注册 Host）
**和** `dsh.client`（Web 客户端 bundle 及其注入包）——后者正是让 dsh 正确注册
客户端 **组件** 的关键。构建产物 `lib/` 已随仓库提交，因此从 GitHub 安装无需构建。

## 安装

> 需要 `dsh` CLI（`npx @deepseek-ai/dsh` 或已安装的客户端）。

### 方式 A —— 从 GitHub 安装（推荐）

```bash
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```

### 方式 B —— 本地路径安装（开发）

```bash
dsh plugin --profile web add /绝对路径/dsh-task-toast
```

随后 **完全退出并重启 dsh**——仅刷新页面不够。Host（Node 端）是一份在
启动时读取的 bundle，设置页（Client 端）可能热更新，但承载通知的 HTTP 路由
只有完整重启后才会注册。

## 更新

插件现在会主动告诉你「上游有新版本」，并能自行重装。

**自动检查** —— Host 在启动 8 秒后、之后每 6 小时查询一次
`https://api.github.com/repos/LouieKeung-13/dsh-task-toast/releases/latest`
（可在设置里关闭）。若上游 tag 比本地版本新，会弹出通知：

```
插件有新版本 1.4.0
当前 1.3.0 · 最新 1.4.0。点击「更新」复制更新命令，或在设置页一键更新
（完成后需重启 dsh）。
```

- 通知上的 **更新** 按钮会把更新命令复制到剪贴板。
- **设置 → 任务提示 → 版本与更新** 显示当前版本 / 最新版本 / 上次检查时间，
  并提供三个按钮：
  - **立即检查** —— 立刻查一次上游。
  - **复制更新命令** —— 复制两行 `remove` + `add` 命令。
  - **一键更新** —— 由 Host 直接执行命令，并把 CLI 输出实时显示在日志框里。

```bash
# 一键更新实际执行的命令
dsh plugin --profile web remove dsh-task-toast
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```

> **仍需重启。** dsh 在启动时读取插件 bundle，所以即便一键更新成功，也必须
> 彻底退出再启动 dsh 才会生效——按钮省掉的是手敲命令，不是重启。
>
> 若一键更新失败（例如 `dsh` 不在 `PATH`、profile 目录被占用），请复制命令
> 到自己的终端执行。

### 从 v1.0.0 / v1.1.x / v1.2.0 升级

v1.0.0 因缺少 `dsh.client` 清单、且直接发布裸源码而未打包，被 dsh 识别为
「不包含任何组件」。从 v1.3.0 起直接在设置页点 **一键更新** 即可；手动方式：

```bash
dsh plugin --profile web remove dsh-task-toast
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```

### 版本记录

- **v1.5.2** —— 修复独立卡片无法弹出的**根因**：脚本使用 LF 换行，而 Windows
  PowerShell 5.1 的 here-string（`@'...'@`）要求 CRLF，导致整个脚本报语法错误、
  进程秒退（旧版把这类失败静默吞掉）。构建脚本现已强制把 ps1 规范为 CRLF。
  同时：卡片进程必须回报「窗口已显示」才算成功，5 秒未回报 / 异常退出时自动
  转回应用内呈现，并把具体失败原因显示在设置页；界面整体改为**单色系**
  （主按钮近黑/近白、去掉彩色竖条与强调色），设置面板的输入框与下拉框统一同色。
- **v1.5.0** —— **独立置顶小卡片**：新增 `scripts/card.ps1`（PowerShell + WinForms），
  生成真正脱离 dsh 窗口的无边框置顶浮窗（DWM 亚克力模糊、圆角、阴影、不抢焦点、
  多卡堆叠、按钮回调 `/card-action`）。设置页的置顶开关改为「通知呈现方式」
  三选一（独立卡片 / 提升 dsh 窗口 / 关闭），并新增「测试卡片」。
  卡片不可用时自动回退到提升窗口，通知不会丢。
- **v1.4.0** —— 跨应用置顶：浮层显示期间把 dsh 桌面窗口抬到所有应用最上层
  （经 PowerShell 调 `SetWindowPos` + `HWND_TOPMOST`，不抢焦点），结束后自动还原。
  设置页新增开关、保持时长、**测试置顶** 按钮。
- **v1.3.0** —— 更新检查（启动 + 每 6 小时）、`update` 通知分类、
  「版本与更新」设置面板、Host 侧一键更新。同时修复了一个潜在缺陷：Host 端
  生成通知标题时会抛 `config is not defined`，导致所有 Host 侧通知静默失效。
- **v1.2.0** —— Apple 风毛玻璃、自适应皮肤主题、显式颜色兜底（修复主按钮空白）。
- **v1.1.1** —— Host 诊断（`host apply()` 日志、连接状态行、测试按钮本地兜底预览）。
- **v1.1.0** —— 修正 dsh 插件契约（`dsh.client` 清单 + 构建产物 `lib/`）。

### 验证

打开 dsh → **设置 → 任务提示**，点击 **测试卡片**（或 **发送测试通知**），
确认卡片在所选角落出现、并浮在所有窗口之上。设置页会显示一行 **Host 连接状态**：

- `Host 已连接` —— 路由已就绪，真实任务完成通知可用。
- `Host 未连接` —— Host 半体未挂载（见下方排障）。

## 故障排查

**现象：设置页能看到，但点击「发送测试通知」毫无反应（无浮层）。**

这通常意味着 **Host 半体未挂载**，即使 Client（设置 UI）已加载。依次检查：

1. **是否完整重启了 dsh？** Host bundle 在启动时读取。在 dsh 运行时 `remove` +
   `add` 再刷新页面，会显示新的设置 UI，但 Host 路由不会注册。请彻底退出 dsh 再启动。
2. **看设置页的 Host 连接状态行：**
   - `Host 已连接` 但仍无浮层 → 多半是事件名与你 dsh 版本不匹配，请反馈。
   - `Host 未连接` → Host 未挂载或 `ctx.webServer` 不可用。
3. **打开浏览器开发者控制台（F12）**，查找以 `[task-toast]` 开头的日志。
   若看到 `长轮询失败（Host 可能未加载/未重启）`，说明 Host HTTP 路由无响应。
4. **查看 dsh 进程日志 / 终端** 是否有：
   - `[dsh-task-toast] host apply() 开始执行…` → Host 插件已加载。
   - `[dsh-task-toast] host 已挂载：11 条 HTTP 路由…` → 路由已注册（正常）。
   - `[dsh-task-toast] 通知呈现方式 = card…卡片脚本可用 = true` → 卡片能力已就绪。
   - `[dsh-task-toast] 独立卡片不可用（exit 1），回退到窗口置顶` → 卡片脚本在
     你的机器上跑不起来，同一行下面会跟一段 `卡片 stderr`，把那段贴给我即可定位。
   - `[dsh-task-toast] FATAL: ctx.webServer 不可用…` → 你的 dsh 版本未提供
     `webServer`，插件无法提供 HTTP（需要改代码适配）。
5. **测试按钮在 Host 不可达时会本地兜底弹窗**，所以出现「测试通知（本地预览）」
   并附带 Host 错误提示，即证明浮层 UI 本身可用——问题只在 Host 链路。

> 说明：本插件开发时未接入真实 dsh 运行环境，Host 端行为（事件名、`webServer`
> API）是参照可运行的 `dsh-session-notify` 实现匹配的，可能需要针对你的 dsh
> 具体版本做校准。上述诊断正是为了快速定位这类偏差。

## 配置

| 选项 | 说明 |
| --- | --- |
| 启用任务提示 | 总开关。 |
| 界面语言 | 中文（简体）/ English —— 本地化全部浮层与设置文案。 |
| 主题 | 跟随系统 / 浅色 / 深色 —— 控制毛玻璃配色。 |
| 跟随 dsh 皮肤主题色 | 用 dsh 的 `--dsw-alias-brand-primary` 为主按钮着色。 |
| 弹出位置 | 左上 / 右上 / 左下 / 右下。 |
| 「查看结果」行为 | 跳转到会话 / 浮层内展开内容。 |
| 显示结果摘要 | 浮层是否渲染结果文字。 |
| 仅推送其他会话 | 抑制当前正在查看的会话的通知。 |
| 自动消失（秒） | 0 = 不自动关闭；否则 N 秒后自动消失。 |
| 任务完成 / 错误 级别 | `关闭` / `应用内提示`（任务默认）/ `系统通知`。 |
| 插件更新提醒 | 内置更新通知的级别（默认「应用内提示」）。 |
| 通知呈现方式 | `独立置顶小卡片`（默认）/ `提升 dsh 窗口` / `关闭（仅应用内）`。 |
| 卡片停留（秒） | 卡片自动消失的时长，同时是窗口置顶的保持时长。鼠标悬停其上时暂停倒计时。 |
| 测试置顶 / 测试卡片 | 卡片模式下弹一张示例卡片；窗口模式下置顶 3 秒后自动恢复。 |
| 发送测试通知 | 推送一条示例通知以验证链路。 |
| 自动检查更新 | 启动时及此后每 6 小时查询上游 Release。 |
| 立即检查 | 立刻查一次上游，并显示当前版本 / 最新版本。 |
| 复制更新命令 | 把两行 `remove` + `add` 命令复制到剪贴板。 |
| 一键更新 | 由 Host 执行 `remove` + `add`，并把 CLI 输出流式显示。 |

> 默认界面语言为 **中文（简体）**。通知标题/正文在 Host 端按同一语言设置本地化。

## 开发

```bash
node scripts/build-static.mjs     # -> lib/{config.js, index.js, client.js}
node scripts/build-dynamic.mjs    # -> dynamic/{host,client}.body.js（可粘贴进 cordis_define）
npm run check                    # 构建两者
npm test                         # 构建 + Host/Client 冒烟测试（tests/smoke-update.mjs）
```

`npm test` 会用 mock 的 GitHub API 完整跑一遍更新链路：路由注册、本地版本解析、
上游更新/更旧/相等三种情形、`update` 通知推送、client bundle 导出。它会先探测
本机是否真的装了 `dsh` CLI——若已安装则 **跳过真实 remove/add**，绝不会破坏你的
现有安装。

- 客户端半体是一个被包裹在 `window.__ModuleLoader__.load` 中的 CommonJS 模块；
  React 由 harness 提供（`require('react')`），因此除 `scripts/build-static.mjs`
  中的字符串包裹外，**无需打包器 / 转译**。
- `dynamic/*.body.js` 为兜底方案：将 `host.body.js` 作为 `code.host`、
  `client.body.js` 作为 `code.client` 粘贴进 `cordis_define`，即可在不安装包的情况下
  按会话加载插件。

### 已知集成注意

- 完成事件与参考插件 `dsh-session-notify` 一致
 （`subagent/end`、`jobs.onJobDone`、`workflow/agent-end`、`agent/status`）。
  具体事件名可能随 dsh 版本变化——若通知不出现，请对照你本地 dsh 版本核实。

## 卸载

```bash
dsh plugin --profile web remove dsh-task-toast
```

## 许可证

[MIT](./LICENSE)
