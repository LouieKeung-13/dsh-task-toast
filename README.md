# dsh-task-toast

> A WorkBuddy-style **task-completion notification overlay** plugin for
> [DeepSeek Harness](https://www.deepseek.com/harness/) (`dsh`).

When a task finishes inside dsh, a corner-docked toast slides in with
**View result / Later / Dismiss** actions — mirroring the completion prompt
you know from WorkBuddy. The dock corner (all four) and the click behavior
(navigate to session vs. expand in place) are fully configurable from a
settings panel.

---

## Features

- **Four-corner docking** — top-left / top-right / bottom-left / bottom-right,
  defaulting to **bottom-right** (WorkBuddy-style).
- **Three-action overlay** — `View result` / `Later` / `Dismiss`, plus a
  persistent close button. Each toast auto-dismisses after 10s.
- **Configurable click behavior**
  - `Navigate to session` (default): `View result` jumps straight to the
    originating session.
  - `Expand content in overlay`: `View result` expands the result summary
    inside the overlay without leaving the current view.
- **Broad completion coverage** — sub-agent end, background job done, workflow
  child-agent end, and top-level session `running → idle` transitions.
- **Zero source patching** — communicates via a host-exposed HTTP channel and
  renders through dsh's public slots, so it survives dsh upgrades.

## Architecture

dsh plugins follow a **Host + Client** split. This plugin implements both halves
with no build step:

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

| Half | File | Runtime | Responsibility |
| --- | --- | --- | --- |
| Host | `lib/index.js` | Node | Event subscription, queueing, HTTP channel (`state` / `config` / `poll` / `test`). |
| Client | `lib/client.js` | WebView | Long-poll consumer, overlay UI, settings panel. Injected via `window.__ModuleLoader__`. |

Configuration is persisted through `POST /dsh-task-toast/config`; no dsh source
is modified.

## Installation

> Requires the `dsh` CLI (`npx @deepseek-ai/dsh` or an installed client).

### Option A — Local path (recommended for development)

```bash
dsh plugin --profile web add /absolute/path/to/dsh-task-toast
```

Then restart the dsh client (or reload the web process: `dsh --profile web web`).

### Option B — From GitHub

```bash
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```

### Verify

Open dsh → **Settings → Task notifications**, then click **Send test
notification** to confirm the overlay appears in the chosen corner.

## Configuration

| Option | Description |
| --- | --- |
| Enable task-completion notifications | Master switch. |
| Overlay position | Top-left / Top-right / Bottom-left / Bottom-right. |
| “View result” behavior | Navigate to session / Expand content in overlay. |
| Show result summary | Whether the toast renders the result text. |

## Development

```bash
# syntax check both halves
npm run check

# local link for iterative testing
dsh plugin --profile web add .
```

The client half is written with `React.createElement` (via a small `h()`
hyperscript helper) because it runs un-bundled inside the WebView. There is no
transpile step.

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
