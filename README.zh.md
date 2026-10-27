# dsh-task-toast

> 一个 WorkBuddy 风格的 **任务完成通知浮层** 插件，面向
> [DeepSeek Harness](https://www.deepseek.com/harness/)（`dsh`）。

当 dsh 内部某个任务结束时，会在客户端指定角落滑入一条浮层提示，附带
**View result / Later / Dismiss** 三个操作按钮——与你在 WorkBuddy 中熟悉的
完成提示一致。停靠角落（四角任选）与点击行为（跳转会话 / 原地展开）均可在
设置面板中自由配置。

[English version](./README.md)

---

## 功能特性

- **四角停靠** —— 左上 / 右上 / 左下 / 右下，默认 **右下角**（WorkBuddy 风格）。
- **三操作浮层** —— `View result` / `Later` / `Dismiss`，附带常驻关闭按钮；单条浮层 10 秒后自动消失。
- **点击行为可配置**
  - `Navigate to session`（默认）：点击「View result」直接跳转到对应的会话。
  - `Expand content in overlay`：点击「View result」在浮层内部展开结果摘要，不离开当前视图。
- **广泛的任务完成覆盖** —— 子代理结束、后台任务完成、工作流子代理结束，以及顶层会话 `running → idle` 状态切换。
- **零源码侵入** —— 通过 Host 暴露的 HTTP 通道通信、经 dsh 公开 slot 渲染，因此可随 dsh 升级而不破。

## 架构

dsh 插件遵循 **Host + Client 双半体** 架构。本插件两个半体均实现，且无构建步骤：

```
                ┌──────────────────────────────────────────┐
   领域事件     │  Host 半体（lib/index.js，Node 主进程）    │
   events  ───► │  • 订阅 Cordis 任务完成事件               │
                │  • 将完成事件封装为通知入队               │
                │  • 暴露 /dsh-task-toast HTTP 通道         │
                └───────────────┬──────────────────────────┘
                                │  HTTP 长轮询 + 配置同步
                ┌───────────────▼──────────────────────────┐
   浮层 + 设置  │  Client 半体（lib/client.js，WebView 运行时）│
                │  • 长轮询 Host 通道                       │
                │  • 将浮层渲染进 `shell.overlay` 槽位      │
                │  • 将设置面板渲染进 `settings.section` 槽位│
                └───────────────────────────────────────────┘
```

| 半体 | 文件 | 运行时 | 职责 |
| --- | --- | --- | --- |
| Host | `lib/index.js` | Node | 事件订阅、入队、HTTP 通道（`state` / `config` / `poll` / `test`）。 |
| Client | `lib/client.js` | WebView | 长轮询消费端、浮层 UI、设置面板。经 `window.__ModuleLoader__` 注入。 |

配置通过 `POST /dsh-task-toast/config` 持久化；不修改任何 dsh 源码。

## 安装

> 需具备 `dsh` CLI（`npx @deepseek-ai/dsh` 或已安装的客户端）。

### 方式 A —— 本地路径（推荐用于开发）

```bash
dsh plugin --profile web add /absolute/path/to/dsh-task-toast
```

随后重启 dsh 客户端（或重载 web 进程：`dsh --profile web web`）。

### 方式 B —— 从 GitHub 安装

```bash
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```

### 验证

打开 dsh → **Settings → Task notifications**，点击 **Send test
notification** 确认浮层出现在所选角落。

## 配置

| 选项 | 说明 |
| --- | --- |
| 启用任务完成通知 | 总开关。 |
| 界面语言 | 中文（简体）/ English —— 切换浮层与设置面板的所有文案。 |
| 浮层位置 | 左上 / 右上 / 左下 / 右下。 |
| 「查看结果」行为 | 跳转会话 / 浮层内展开内容。 |
| 显示结果摘要 | 浮层是否渲染任务结果文字。 |

> 界面内置双语（中文 / English），通知标题与正文由 Host 端按同一语言设置本地化。默认：中文（简体）。

## 开发

```bash
# 语法校验两个半体
npm run check

# 本地链接以迭代测试
dsh plugin --profile web add .
```

Client 半体使用 `React.createElement`（借助一个轻量 `h()` hyperscript 助手）编写，
因为它在 WebView 内**无打包直接运行**，没有编译/转译步骤。

### 已知集成说明

- 任务完成事件沿用参考插件 `dsh-session-notify` 所用的事件
  （`subagent/end`、`jobs.onJobDone`、`workflow/agent-end`、`agent/status`）。
  具体事件名可能随 dsh 版本变动——若通知不出现，请对照你本地安装的构建版本核实。

## 卸载

```bash
dsh plugin --profile web remove dsh-task-toast
```

## 许可证

[MIT](./LICENSE)
