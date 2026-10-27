# dsh-task-toast

> 一个 WorkBuddy 风格的 **任务完成提示浮层** 插件，适用于
> [DeepSeek Harness](https://www.deepseek.com/harness/)（`dsh`）。

[English documentation](./README.md)

当 dsh 内的任务完成时，会在屏幕角落滑入一张提示卡片，提供
**查看结果 / 稍后 / 忽略** 三个操作——与你在 WorkBuddy 里熟悉的完成提示一致。
浮层的停靠角落（四角任选）、界面语言（中文 / 英文），以及点击「查看结果」的行为
（跳转到会话 / 浮层内展开）都可在设置面板中配置。

---

## 功能特性

- **四角停靠** —— 左上 / 右上 / 左下 / 右下，默认 **右下角**（WorkBuddy 风格）。
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

随后重启 dsh 客户端（或重载 web 进程：`dsh --profile web web`）。

### 从 v1.0.0 升级

v1.0.0 因缺少 `dsh.client` 清单、且直接发布裸源码而未打包，被 dsh 识别为
「不包含任何组件」。请 **重新安装 / 更新** 到 v1.1.0：

```bash
dsh plugin --profile web remove dsh-task-toast
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```

### 验证

打开 dsh → **设置 → 任务提示**，点击 **发送测试通知**，确认浮层在所选角落出现。

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
