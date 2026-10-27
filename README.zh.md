# dsh-task-toast

> 一个 **任务完成提示浮层** 插件，适用于
> [DeepSeek Harness](https://www.deepseek.com/harness/)（`dsh`）。

[English documentation](./README.md)

当 dsh 内的任务完成时，会在屏幕角落滑入一张提示卡片，提供
**查看结果 / 稍后 / 忽略** 三个操作。
浮层的停靠角落（四角任选）、界面语言（中文 / 英文），以及点击「查看结果」的行为
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
- **广泛的完成事件覆盖** —— 子代理结束、后台任务完成、工作流子任务结束、
  以及顶层会话 `running → idle` 切换。
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
| Host | `src/static/host.js` → `lib/index.js` | Node | 事件订阅、入队、HTTP 通道（`state` / `config` / `poll` / `test` / `active`）。 |
| Client | `src/static/client.js` → `lib/client.js` | WebView | 长轮询消费、浮层 UI、设置面板。通过 `window.__ModuleLoader__` 注入。 |

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

### 从 v1.0.0 升级

v1.0.0 因缺少 `dsh.client` 清单、且直接发布裸源码而未打包，被 dsh 识别为
「不包含任何组件」。请 **重新安装 / 更新** 到 v1.1.1：

```bash
dsh plugin --profile web remove dsh-task-toast
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```

### 验证

打开 dsh → **设置 → 任务提示**，点击 **发送测试通知**，确认浮层在所选角落出现。
设置页现在会显示一行 **Host 连接状态**：

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
   - `[dsh-task-toast] host 已挂载：5 条 HTTP 路由…` → 路由已注册（正常）。
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
| 弹出位置 | 左上 / 右上 / 左下 / 右下。 |
| 「查看结果」行为 | 跳转到会话 / 浮层内展开内容。 |
| 显示结果摘要 | 浮层是否渲染结果文字。 |
| 仅推送其他会话 | 抑制当前正在查看的会话的通知。 |
| 自动消失（秒） | 0 = 不自动关闭；否则 N 秒后自动消失。 |
| 任务完成 / 错误 级别 | `关闭` / `应用内提示`（任务默认）/ `系统通知`。 |
| 发送测试通知 | 推送一条示例通知以验证链路。 |

> 默认界面语言为 **中文（简体）**。通知标题/正文在 Host 端按同一语言设置本地化。

## 开发

```bash
node scripts/build-static.mjs     # -> lib/{config.js, index.js, client.js}
node scripts/build-dynamic.mjs    # -> dynamic/{host,client}.body.js（可粘贴进 cordis_define）
npm run check                    # 构建两者
```

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
