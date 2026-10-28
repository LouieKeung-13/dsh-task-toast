# dsh-task-toast

[中文文档](./README.zh.md)

When a task finishes inside dsh, a **standalone floating card** (or an in-app
toast) appears in a corner of the screen with
**View result / Later / Dismiss** actions. The dock corner (all four), the UI language (中文 / English),
and the click behavior (navigate to session vs. expand in place) are all
configurable from a settings panel.

---

## Features

- **Four-corner docking** — top-left / top-right / bottom-left / bottom-right,
  defaulting to **bottom-right**.
- **Three-action overlay** — `View result` / `Later` / `Dismiss`, plus a
  persistent close button. Each toast auto-dismisses after a configurable delay.
- **Configurable click behavior**
  - `Navigate to session` (default): `View result` jumps straight to the
    originating session.
  - `Expand content in overlay`: `View result` expands the result summary inside
    the overlay without leaving the current view (a `Copy result` button appears).
- **Bilingual UI** — 中文（简体） / English; the overlay and settings chrome, as
  well as the host-generated titles/bodies, follow a single language setting.
- **Apple-style glassmorphism** — frosted, translucent cards with
  `backdrop-filter: blur + saturate`, soft layered shadows and a springy slide-in,
  replacing the flat "AI-ish" look. All colors use explicit fallbacks so the
  overlay never renders blank even if dsh's CSS variables are unavailable.
- **Adaptive theme** — `System` (follows `prefers-color-scheme`) / `Light` /
  `Dark`, plus an optional **Match dsh skin accent** toggle that tints the
  primary action with dsh's own `--dsw-alias-brand-primary`.
- **Broad completion coverage** — sub-agent end, background job done, workflow
  child-agent end, and top-level session `running → idle` transitions.
- **Always on top (cross-application), two flavours)**
  - `Standalone floating card` (default): spawns a **borderless window detached
    from dsh** — one corner of the screen, genuinely `TopMost` above every app,
    with DWM acrylic blur, rounded corners and a soft shadow. It does **not steal
    focus**, so you can keep typing elsewhere. Multiple cards stack vertically.
  - `Raise the dsh window`: lifts the whole dsh window to the front (the previous
    behaviour), handy when you want to jump straight back into dsh.
  - Both are Windows desktop-client only; web/CLI mode skips them.
- **Built-in update checker** — the Host polls the upstream GitHub release on
  startup and every 6 hours. When a newer version exists, a toast with an
  **Update** button appears, and Settings → Task notifications offers
  **Check now**, **Copy update command** and **One-click update** (runs
  `dsh plugin remove` + `add` for you), so you never have to uninstall/reinstall
  by hand again.
- **Zero source patching** — communicates via a host-exposed HTTP channel and
  renders through dsh's public slots, so it survives dsh upgrades.

## Architecture

dsh plugins follow a **Host + Client** split. This plugin is shipped as a
**static bundle** (what `dsh plugin add github:` consumes):

```
                ┌──────────────────────────────────────────┐
   domain       │  Host  (lib/index.js, Node main process)  │
   events  ───► │  • subscribes to Cordis completion events │
                │  • enqueues notification envelopes        │
                │  • exposes /dsh-task-toast HTTP channel   │
                └───────────────┬──────────────────────────┘
                                │  HTTP long-poll + config
                ┌───────────────▼──────────────────────────┐
   overlay      │  Client (lib/client.js, WebView runtime)  │
   + settings ──│  • long-polls the host channel            │
                │  • renders toast into `shell.overlay`     │
                │  • renders config into `settings.section` │
                └───────────────────────────────────────────┘
```

| Half | File (source → artifact) | Runtime | Responsibility |
| --- | --- | --- | --- |
| Host | `src/static/host.js` → `lib/index.js` | Node | Event subscription, queueing, HTTP channel (`state` / `config` / `poll` / `test` / `active` / `version` / `check-update` / `update` / `topmost` / `card` / `card-action`), upstream release polling, card spawning and window elevation. |
| Client | `src/static/client.js` → `lib/client.js` | WebView | Long-poll consumer, overlay UI, settings panel, update panel. Injected via `window.__ModuleLoader__`. |
| Card | `scripts/card.ps1` | WinForms | Standalone borderless always-on-top card (acrylic blur + rounded corners + three actions); posts the clicked action back to the Host. |

### How the standalone card works

dsh ships in two shapes: an **Electron desktop client**
(`D:\...\DeepSeek Harness.exe`, Electron 44) and a plain **web/CLI** mode. Plugin
code itself runs in a *Node-mode* child process (`ELECTRON_RUN_AS_NODE=1`), which
does **not** have `BrowserWindow` — so a plugin cannot create a native window
in-process. Instead it **spawns a separate PowerShell + WinForms process**:

```
notification ──► Host (Node)
                  └─ spawn powershell -STA -File scripts/card.ps1 -Title … -Position …
                       ├─ SetWindowCompositionAttribute(ACCENT_ENABLE_ACRYLICBLURBEHIND)  ← acrylic
                       ├─ DwmSetWindowAttribute(WINDOW_CORNER_PREFERENCE = ROUND)         ← Win11 corners
                       ├─ FormBorderStyle=None + TopMost=true                            ← borderless, topmost
                       └─ click → POST /dsh-task-toast/card-action {id, action}
                            ├─ view   → navigate the page to the session + bring dsh forward
                            ├─ later  → re-notify in 5 minutes
                            └─ ignore → drop
```

- The card lives in its own process, **independent of the dsh window**: it stays
  visible even when dsh is minimised or covered.
- Multiple cards stack vertically via `-Slot` (bottom-anchored for the bottom
  corners) instead of overlapping.
- **Automatic fallback**: if the script is missing, PowerShell is policy-blocked or
  compilation fails, the Host notices the child exiting abnormally within 4 s and
  falls back to raising the dsh window — a notification is never lost.
- `Raise the dsh window` uses `scripts/topmost.ps1`: `EnumWindows` matches the
  Electron main window by `process.ppid` (title fallback `matchTitle`), then
  `SetWindowPos(hwnd, HWND_TOPMOST)` — also without stealing focus
  (`SWP_NOACTIVATE`).
- **Windows only** (relies on `user32.dll` / `dwmapi.dll`). macOS/Linux skip it.

> The card is a native WinForms window approximating frosted glass with DWM acrylic
> plus rounded corners — it is not the same as macOS `backdrop-filter`. The in-app
> overlay keeps the full glassmorphism treatment.

`package.json` declares both `dsh.bundle.patch` (host registration via
`cordis.patch.yml`) **and** `dsh.client` (the Web client bundle + injected
packages), which is what makes dsh register the client **component**. The built
`lib/` directory is committed so the GitHub install needs no build step.

## Installation

> Requires the `dsh` CLI (`npx @deepseek-ai/dsh` or an installed client).

### Option A — From GitHub (recommended)

```bash
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```

### Option B — Local path (development)

```bash
dsh plugin --profile web add /absolute/path/to/dsh-task-toast
```

Then **fully quit and restart dsh** — a page reload is NOT enough. The Host
(Node) half is a bundle that is read at boot; the client half (settings UI) may
hot-reload, but the HTTP routes that power notifications only come up after a
full restart.

## Updates

The plugin now tells you when a newer release exists, and can reinstall itself.

**Automatic check** — the Host queries
`https://api.github.com/repos/LouieKeung-13/dsh-task-toast/releases/latest`
8 seconds after boot and then every 6 hours (toggleable). If the upstream tag is
newer than the installed version, a toast appears:

```
Plugin update available: 1.4.0
Installed 1.3.0 · latest 1.4.0. Click "Update" to copy the command, or use
one-click update in Settings (restart dsh afterwards).
```

- **Update** on that toast copies the update command to your clipboard.
- **Settings → Task notifications → Version & updates** shows installed vs.
  latest, the last check time, and three buttons:
  - **Check now** — forces an immediate upstream check.
  - **Copy update command** — copies the two-line `remove` + `add` command.
  - **One-click update** — the Host runs the command for you and streams the
    CLI output into a log box.

```bash
# what one-click update runs
dsh plugin --profile web remove dsh-task-toast
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```

> **Restart is still required.** dsh reads the plugin bundle at boot, so even a
> successful one-click update only takes effect after you fully quit and
> relaunch dsh. The button saves you the typing, not the restart.
>
> If one-click update fails (for example because dsh is not on `PATH`, or the
> profile directory is locked), copy the command and run it in your own terminal.

### Upgrading from v1.0.0 / v1.1.x / v1.2.0

v1.0.0 reported "this plugin package contains no components" because it lacked
the `dsh.client` manifest and shipped raw source instead of a built bundle.
From v1.3.0 onwards you can just use **One-click update** in the settings page;
manually:

```bash
dsh plugin --profile web remove dsh-task-toast
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```

### Changelog

- **v1.5.2** — root-cause fix for the standalone card never appearing: the script
  used LF line endings, but Windows PowerShell 5.1 requires CRLF for here-strings
  (`@'...'@`), so parsing failed and the process exited instantly — and the old
  code swallowed that failure silently. The build now enforces CRLF for ps1
  files. The card must also report "shown" back to the Host; on failure or a 5s
  timeout the notification falls back to the in-app overlay and the exact error
  is shown in Settings. The UI is now **monochrome** (near-black / near-white
  primary buttons, no colored stripes or accent), and settings inputs & selects
  share one consistent color.
- **v1.5.0** — **standalone floating card**: adds `scripts/card.ps1`
  (PowerShell + WinForms) which spawns a borderless always-on-top window truly
  detached from dsh (DWM acrylic blur, rounded corners, shadow, no focus stealing,
  vertical stacking, `/card-action` button callback). The old topmost toggle
  becomes a three-way **Notification surface** setting (card / raise window / off)
  plus a **Test card** button. If the card cannot start, it falls back to raising
  the window so no notification is lost.
- **v1.4.0** — always-on-top: while a toast is visible, the dsh desktop window is
  raised above every other app (`SetWindowPos` + `HWND_TOPMOST` through a
  PowerShell helper, no focus stealing) and restored afterwards. Settings gained
  a toggle, a hold-time field and a **Test topmost** button.
- **v1.3.0** — update checker (startup + every 6 h), `update` notification
  category, Version & updates settings panel, one-click update via the Host.
  Also fixes a latent bug where host-generated notification titles threw
  `config is not defined`, which silently broke every host-side notification.
- **v1.2.0** — Apple-style glassmorphism, adaptive skin theme, explicit color
  fallbacks (fixes the blank primary button).
- **v1.1.1** — Host diagnostics (`host apply()` log, connection status row,
  local fallback preview for the test button).
- **v1.1.0** — correct dsh plugin contract (`dsh.client` manifest + built
  `lib/` bundle).

### Verify

Open dsh → **Settings → Task notifications**, then click **Test card** (or
**Send test notification**) to confirm the card appears in the chosen corner and
floats above every window. The settings page also shows a **Host status** row:

- `Host connected` — routes are live; real task-completion notifications work.
- `Host unreachable` — the Host half did not mount (see Troubleshooting).

## Troubleshooting

**Symptom: the settings page shows, but clicking *Send test notification* does
nothing (no overlay).**

This almost always means the **Host half is not mounted**, even though the Client
(settings UI) loads. Check, in order:

1. **Did you fully restart dsh?** The Host bundle is read at boot. `remove` +
   `add` while dsh is running, followed by a page refresh, will show the new
   settings UI but leave the Host routes unregistered. Quit dsh completely and
   relaunch.
2. **Check the Host status row** in Settings → Task notifications.
   - `Host connected` but still no toast → report it; likely an event-name
     mismatch for your dsh version.
   - `Host unreachable` → Host did not mount or `ctx.webServer` is unavailable.
3. **Open the browser DevTools console (F12)** and look for lines prefixed
   `[task-toast]`. If you see `长轮询失败（Host 可能未加载/未重启）`, the Host
   HTTP routes are not responding.
4. **Check the dsh process log / terminal** for:
   - `[dsh-task-toast] host apply() 开始执行…` → Host plugin loaded.
   - `[dsh-task-toast] host 已挂载：11 条 HTTP 路由…` → routes registered (good).
   - `[dsh-task-toast] 通知呈现方式 = card…卡片脚本可用 = true` → card support is ready.
   - `[dsh-task-toast] 独立卡片不可用（exit 1），回退到窗口置顶` → the card script
     failed on your machine; the following `卡片 stderr` line holds the reason.
   - `[dsh-task-toast] FATAL: ctx.webServer 不可用…` → your dsh version does not
     expose `webServer`; the plugin cannot serve HTTP (a code change is needed).
5. **The test button falls back to a local preview** if the Host is unreachable,
   so a popup with "测试通知（本地预览）" and a Host-error note proves the overlay
   UI itself works — the issue is purely the Host link.

> Note: this plugin was developed without a live dsh runtime, so Host-side
> behavior (event names, `webServer` API) is matched against the reference
> `dsh-session-notify` implementation and may need calibration for your exact
> dsh build. The diagnostics above are designed to localize any such gap.

## Configuration

| Option | Description |
| --- | --- |
| Enable task notifications | Master switch. |
| UI language | 中文（简体） / English — localizes all overlay and settings chrome. |
| Theme | System / Light / Dark — controls the glassmorphism palette. |
| Match dsh skin accent | Tints the primary button with dsh's `--dsw-alias-brand-primary`. |
| Overlay position | Top-left / Top-right / Bottom-left / Bottom-right. |
| "View result" behavior | Navigate to session / Expand content in overlay. |
| Show result summary | Whether the toast renders the result text. |
| Only other sessions | Suppress notifications for the session you are currently viewing. |
| Auto-dismiss (seconds) | 0 = never auto-close; otherwise the toast closes after N seconds. |
| Task completed / Error level | `off` / `In-app toast` (default for task) / `System notification`. |
| Plugin update alerts | Level for the built-in update notification (`In-app toast` by default). |
| Notification surface | `Standalone floating card` (default) / `Raise the dsh window` / `Off (in-app only)`. |
| Card lifetime (seconds) | How long the card stays on screen; also the topmost hold time. Hovering over it pauses the countdown. |
| Test card / Test topmost | In card mode, shows a sample card; in window mode, raises the window for 3 s and restores it. |
| Send test notification | Pushes a sample toast to verify the pipeline. |
| Check automatically | Poll the upstream release on startup and every 6 hours. |
| Check now | Force an immediate update check and show installed vs. latest. |
| Copy update command | Copy the two-line `remove` + `add` command to the clipboard. |
| One-click update | Runs `remove` + `add` on the Host and streams the CLI output. |

> Default UI language is 中文（简体）. The notification title and body are
> localized on the host side and follow the same language setting.

## Development

```bash
node scripts/build-static.mjs    # -> lib/{config.js, index.js, client.js}
node scripts/build-dynamic.mjs   # -> dynamic/{host,client}.body.js (cordis_define paste)
npm run check                   # build both
npm test                        # build + Host/client smoke test (tests/smoke-update.mjs)
```

`npm test` exercises the update pipeline end to end against a mocked GitHub
API: route registration, local version resolution, newer/older/equal upstream
versions, the `update` notification push, and client bundle export. It detects
whether a real `dsh` CLI is installed and, if so, **skips the real
remove/add** so it can never damage your live install.

- The client half is a CommonJS module wrapped in `window.__ModuleLoader__.load`;
  React is provided by the harness (`require('react')`), so there is **no
  bundler/transpile** step beyond the string-wrap in `scripts/build-static.mjs`.
- `dynamic/*.body.js` are a fallback: paste `host.body.js` as `code.host` and
  `client.body.js` as `code.client` into a `cordis_define` call to load the
  plugin per-session without a package install.

### Known integration notes

- Completion events mirror those used by the `dsh-session-notify` reference
  plugin (`subagent/end`, `jobs.onJobDone`, `workflow/agent-end`,
  `agent/status`). Exact event names may vary by dsh version — verify against
  your installed build if notifications do not appear.

## Uninstall

```bash
dsh plugin --profile web remove dsh-task-toast
```

## License

[MIT](./LICENSE)
