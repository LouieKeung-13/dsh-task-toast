# dsh-task-toast v1.6.2

dsh（DeepSeek Harness）任务完成提示浮层插件 —— 类 WorkBuddy 的跨应用置顶通知，支持四角停靠、独立 WinForms 置顶卡片、Windows 系统通知双通道、中英双语。

## 中文版

### 本次更新（v1.6.0 → v1.6.2）

**v1.6.2 — 修掉「一键更新点了却提示失败」的版本发现缺陷**
- 版本检查原来只看 `releases/latest`。如果仓库只推了 tag、没有发 Release，它就会返回上一个旧版本号，于是自更新的**防降级**逻辑拒绝覆盖，表现就是「明明有新版本，更新却失败」。
- 现在同时读 `releases/latest` 与 `tags` 列表，取**版本号更大的那个**，从此不再依赖是否发过 Release。

**v1.6.1 — 堵死「更新一次之后卡片又弹不出来」的复发通道**
- 仓库的 `core.autocrlf=true` 会把 `scripts/*.ps1` **以 LF 存进 GitHub**，而自更新是从 GitHub 直接下载文件内容落盘的 —— 也就是说**每次自更新都会把卡片脚本写回 LF**，于是 Windows PowerShell 5.1 的 here-string 解析错位、脚本秒退，症状与 v1.5.2 一模一样（独立卡片静默不显示）。
- 双重修复：① 新增 `.gitattributes`（`*.ps1 -text`），仓库里存的就是 CRLF；② 自更新落盘时对 `.ps1` 强制转 CRLF（不依赖仓库设置，任何来源都兜得住）。

**v1.6.0 — 修好「独立置顶小卡片弹不出来」的真正根因，并新增系统通知双通道**
- 根因：`card.ps1` 取 `$env:LOCALAPPDATA` 推导编译缓存目录，而 dsh 的 Host 是 Electron 的 Node 子进程，该变量为空 → 缓存推导直接抛错 → 每次通知都要即时编译 C#。实测首次编译可达 4~5 秒，撞上 v1.5.2 的 5 秒看门狗，卡片刚要显示就被 kill。现已逐级回退缓存目录（`LOCALAPPDATA → APPDATA → USERPROFILE\AppData\Local → TEMP`），并把等待窗口放宽到 20 秒。实测：冷编译 421ms、热启动到「窗口已显示」362ms（此前 4910ms）。
- 每个阶段都向 stdout 打点，并写入 `%APPDATA%\dsh-task-toast\card.log`；设置页在卡片失败时直接显示失败阶段 + 原因 + 日志尾部。
- 新增 **Windows 系统通知**通道（WinRT Toast）：可勾选「同时发送 Windows 系统通知」，卡片弹出的同时发一条原生通知——横幅浮在所有窗口之上、并沉淀到系统通知中心；卡片万一没起来，它就是兜底通道，通知不会丢。
- 设置面板全部改用 dsh 设计令牌（`--dsw-alias-*`），与 dsh 自带设置项同色；澄清「应用内浮层自动消失」与「卡片停留」是两条互不冲突的独立计时；更新区新增**强制重装（忽略版本）**按钮，并支持 `api.github.com` 限流时自动回退 `raw.githubusercontent.com`。

### 安装 / 更新
```bash
# 桌面客户端（DeepSeek Harness）
dsh plugin --profile desktop add github:LouieKeung-13/dsh-task-toast

# 命令行 / 浏览器
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```
装完后**彻底退出并重启 dsh** 即可生效。已在插件设置页内置「检查更新 / 一键更新 / 强制重装」。

---

## English

### What's new (v1.6.0 → v1.6.2)

**v1.6.2 — fix "update button says failed even though a newer version exists"**
- Version discovery only read `releases/latest`. When the repo had tags but no published Release, the API returned the *previous* version, so the self-update downgrade guard refused to overwrite — which looked like "update failed even though a newer version exists".
- It now reads both `releases/latest` and the `tags` list and takes the higher version, so it no longer depends on whether a Release was ever published.

**v1.6.1 — close the relapse path where the card breaks again right after an update**
- The repo's `core.autocrlf=true` stores `scripts/*.ps1` as **LF on GitHub**, and self-update writes the downloaded bytes straight to disk — so **every update rewrote the card script as LF**, which makes Windows PowerShell 5.1 mis-parse the here-string and exit instantly (symptom identical to v1.5.2: the card silently never shows).
- Fixed twice over: a `.gitattributes` (`*.ps1 -text`) so the repo stores CRLF, plus a forced CRLF conversion whenever self-update writes any `.ps1`.

**v1.6.0 — fix the real reason the standalone card never appeared, and add a system-notification channel**
- Root cause: `card.ps1` derived its compile-cache directory from `$env:LOCALAPPDATA`, which is **empty** inside dsh's Host (a Node child of Electron). The cache lookup threw, so every notification recompiled the C# in process — measured at 4–5 s cold, which collided with v1.5.2's 5-second watchdog: the card was killed right as it was about to appear. The cache dir now falls back through `LOCALAPPDATA → APPDATA → USERPROFILE\AppData\Local → TEMP`, and the wait window is 20 s. Measured: 421 ms cold compile, **362 ms** from spawn to "shown" (was 4910 ms).
- Every stage emits a stdout marker and is appended to `%APPDATA%\dsh-task-toast\card.log`; Settings shows the failing stage, reason and log tail whenever a card fails.
- New **Windows toast** channel (WinRT): optionally fires a native notification alongside the card — banner above every window, kept in the Action Center. It is also the fallback when the card cannot start, so nothing is ever lost.
- Settings now uses dsh design tokens (`--dsw-alias-*`) so the panel matches the built-in rows; "auto-dismiss" and "card lifetime" are documented as two independent, non-conflicting timers; added **Force reinstall (ignore version)** and a `raw.githubusercontent.com` fallback when the GitHub API is rate-limited.

### Install / Update
```bash
# Desktop client (DeepSeek Harness)
dsh plugin --profile desktop add github:LouieKeung-13/dsh-task-toast

# CLI / browser
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```
After installing, **fully quit and restart dsh** for it to take effect. The plugin Settings panel has built-in "Check for updates / Update now / Force reinstall".
