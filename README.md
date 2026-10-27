# dsh-task-toast

> A WorkBuddy-style **task-completion notification overlay** plugin for
> [DeepSeek Harness](https://www.deepseek.com/harness/) (`dsh`).

[中文文档](./README.zh.md)

When a task finishes inside dsh, a corner-docked toast slides in with
**View result / Later / Dismiss** actions. The dock corner (all four), the UI language (中文 / English),
and the click behavior (navigate to session vs. expand in place) are all
configurable from a settings panel.

---

## Features

- **Four-corner docking** — top-left / top-right / bottom-left / bottom-right,
  defaulting to **bottom-right** (WorkBuddy-style).
- **Three-action overlay** — `View result` / `Later` / `Dismiss`, plus a
  persistent close button. Each toast auto-dismisses after a configurable delay.
- **Configurable click behavior**
  - `Navigate to session` (default): `View result` jumps straight to the
    originating session.
  - `Expand content in overlay`: `View result` expands the result summary inside
    the overlay without leaving the current view (a `Copy result` button appears).
- **Bilingual UI** — 中文（简体） / English; the overlay and settings chrome, as
  well as the host-generated titles/bodies, follow a single language setting.
- **Broad completion coverage** — sub-agent end, background job done, workflow
  child-agent end, and top-level session `running → idle` transitions.
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
| Host | `src/static/host.js` → `lib/index.js` | Node | Event subscription, queueing, HTTP channel (`state` / `config` / `poll` / `test` / `active`). |
| Client | `src/static/client.js` → `lib/client.js` | WebView | Long-poll consumer, overlay UI, settings panel. Injected via `window.__ModuleLoader__`. |

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

Then restart the dsh client (or reload the web process: `dsh --profile web web`).

### Upgrading from v1.0.0

v1.0.0 reported "this plugin package contains no components" because it lacked
the `dsh.client` manifest and shipped raw source instead of a built bundle.
**Re-install or update** to v1.1.0:

```bash
dsh plugin --profile web remove dsh-task-toast
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```

### Verify

Open dsh → **Settings → Task notifications**, then click **Send test
notification** to confirm the overlay appears in the chosen corner.

## Configuration

| Option | Description |
| --- | --- |
| Enable task notifications | Master switch. |
| UI language | 中文（简体） / English — localizes all overlay and settings chrome. |
| Overlay position | Top-left / Top-right / Bottom-left / Bottom-right. |
| "View result" behavior | Navigate to session / Expand content in overlay. |
| Show result summary | Whether the toast renders the result text. |
| Only other sessions | Suppress notifications for the session you are currently viewing. |
| Auto-dismiss (seconds) | 0 = never auto-close; otherwise the toast closes after N seconds. |
| Task completed / Error level | `off` / `In-app toast` (default for task) / `System notification`. |
| Send test notification | Pushes a sample toast to verify the pipeline. |

> Default UI language is 中文（简体）. The notification title and body are
> localized on the host side and follow the same language setting.

## Development

```bash
node scripts/build-static.mjs    # -> lib/{config.js, index.js, client.js}
node scripts/build-dynamic.mjs   # -> dynamic/{host,client}.body.js (cordis_define paste)
npm run check                   # build both
```

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
