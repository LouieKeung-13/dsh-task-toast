# dsh-task-toast

[简体中文](README.zh.md)

Cross-platform task notifications for [DeepSeek Harness](https://www.deepseek.com/harness/). Get a system notification when a task finishes, preview a short result, and open the conversation that produced it.

## Maintenance status

As of November 21, 2026, this project has completed its intended functionality and is in maintenance-only mode. Active feature development has stopped. The current installable code and full usage documentation are retained. Maintenance resumes only for an actual malfunction, a DSH compatibility change, or a clearly identified interaction obstacle.

## Features

- **System notifications** on Windows and macOS through the client’s Web Notifications API.
- **Result previews** in task notifications, with a direct action to open the source conversation. On Windows Desktop, clicking restores a minimized or tray-hidden DSH window before selecting that conversation.
- **In-app notifications** with `View result`, `Later`, and `Dismiss` actions,
  plus local notification history that can be reviewed and replayed.
- **Two optional notification sounds** (`Soft` and `Clear`); disabled by default.
- **Focus-aware delivery** — while the selected conversation is running, its
  completion notification is recorded in history rather than interrupting you;
  other conversations can still notify.
- **Bilingual settings and content** (Simplified Chinese / English), themes, four-corner placement, and configurable dismissal.
- **Market-managed updates** — manage releases through dshmarket. The plugin no longer overwrites installed files or runs its own package-manager commands.
- **Completion coverage** for agent, workflow, background-job, and top-level session events.

## Installation and updates

This repository contains the current installable source and prebuilt bundles. dshmarket is the intended marketplace; catalog submission and approval are separate from updating this repository.

### DSH desktop app

Open **Plugins → Add plugin → Install third-party plugin**, enter the repository address below, install it, and enable the plugin:

```text
https://github.com/LouieKeung-13/dsh-task-toast
```

To replace an existing installation, uninstall that copy in the desktop app, then install from this address. The first migration from an older build needs the complete restart described below. A restart performed before replacing the package still loads the old build.

### DSH Web profile

```sh
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```

The desktop profile is managed by the desktop app; use its plugin manager for installation.

### Updates through dshmarket

- Once the catalog includes this repository, use **Plugins → Plugin Market → Installed** in dshmarket to check and apply updates. Its automatic checks only remind; they do not silently install updates. A local test package does not automatically switch to a market-managed source.
- The notification settings' **Open Plugins** button opens the Host's plugin page, where you can enter Plugin Market.
- Follow the Host's actual result: applied, refresh the page, or restart required. A file replacement alone is not evidence that new code is running.

The first migration from an older build that did not release its HTTP routes needs one complete DSH restart. Subsequent replacements can unload and remount this plugin without retaining those old routes. The implementation preserves its in-process settings, queue and delivery cursor; it does not add configuration persistence across application exits.

## Quick start

1. Open **Settings → Task notifications** and enable the plugin.
2. Set **Task completed** to **System notification**. New installations use this level by default. Settings survive supported reloads within the same Host process; after a complete restart, check your notification preferences again.
3. Allow system-notification permission when prompted. The operating system controls whether banners and notification-center entries are shown.
4. Keep **Show result summary** enabled to add a task-result preview. The complete banner body is capped at 240 characters, including the completion text. With summaries disabled, the completion title remains but the result body is omitted. Click the banner to open the conversation and view the full response.
5. Optionally choose **Soft** or **Clear** under **Task completion sound**, then use **Preview**. Sounds default to **Off**.

The **Send test notification** button checks delivery. A test notification can carry the currently selected conversation, but does not contain a real task result. Use a real background task to verify the result preview and session navigation end to end.

## Notification behavior

| Setting | Behavior |
| --- | --- |
| **System notification** | Sends one OS notification. If permission is denied, the API is unavailable, or delivery fails, the plugin falls back to one in-app toast. It does not also show a second in-app toast after successful delivery. |
| **In-app toast** | Shows the result and the configured `View result`, `Later`, and `Dismiss` actions inside DSH. |
| **Off** | Suppresses that notification category. |
| **Show result summary** | Uses plain assistant text from the latest answered user turn. Reasoning and tool-call/result content are excluded. When summaries are disabled, the system banner keeps its completion title but omits the result body; when no suitable answer exists, it uses the generic completion body. |
| **Task completion sound** | `Off`, `Soft`, or `Clear`. The selected cue is synthesized locally; it does not use downloaded audio or platform shell scripts. |

System banners show a short preview, not the full transcript. The notification
body is capped at 240 characters total, including the localized completion text
and result summary. It is plain text: the plugin does not render HTML or execute
result content. Because the preview is managed by the OS, it may appear on the
lock screen; disable **Show result summary** if task output may be sensitive.

When a notification is generated while its conversation is being viewed and is still running, it is recorded in history without interrupting the user. A different conversation can still notify. Suppressed notifications are not automatically replayed later.

## Settings

- **Task completed / Error** — `Off`, `In-app toast`, or `System notification` per category.
- **View result** — navigate to the source conversation or expand the in-app toast.
- **Show result summary** — include the task result where supported.
- **Only other sessions** — suppress notifications for the focused, idle conversation.
- **Task completion sound** — `Off` (default), `Soft`, or `Clear`, with **Preview** and **Mute** controls.
- **Overlay position, theme, language, and auto-dismiss** — customize in-app notifications.
- **Notification surface** — optional legacy card/window helpers for app-level notifications; behavior and available actions vary by platform. System notifications remain a separate channel.
- **History** — review, replay, or clear recent notifications. The static desktop Host stores at most 200 history entries locally; dynamic-plugin history is in memory.

## Troubleshooting

**No system banner appears**

- Confirm **Task completed** is set to **System notification**.
- Check DSH’s **System notification permission** status and the OS notification / Focus Assist / Do Not Disturb settings.
- Test while DSH is running. The OS may suppress a banner while still retaining the notification.
- If permission is denied or the system channel fails, look for the single in-app fallback toast.

**The notification has no result preview**

- Turn on **Show result summary**.
- A preview is included only when the latest user turn has a suitable assistant text response. Reasoning, tool content, and older answers are intentionally excluded.
- The OS banner is capped at a short preview; open the conversation for the full result.

**Clicking a system notification does not open the conversation**

- Use a build that includes system-notification session navigation and follow the Host’s refresh or restart instruction.
- Keep DSH running in the background; minimizing it or closing the main window to the system tray is supported on Windows Desktop. Fully quitting the app is outside this restoration flow. After applying the update and any requested refresh or restart, verify both states with newly generated real task notifications.
- If navigation fails, the plugin reports the failure in Settings and provides an in-app fallback that can be expanded or retried from history.
- Verify with a real task notification; the test button only verifies its own delivery and the currently selected session.

**Settings appear but notifications do not arrive**

- Check the Host’s activation result after installing or updating; refresh or restart when it requests that action.
- Check the **Host status** in Settings. `Host unreachable` means the Host routes did not load; inspect the DSH process log and client console for `[dsh-task-toast]` or `[task-toast]` errors.

## Uninstall

- **DSH desktop app:** use **Plugins → Installed plugins** in the desktop app.
- **Web profile:**

  ```sh
  dsh plugin --profile web remove dsh-task-toast
  ```

## Development

Requirements: Node.js 18 or newer. No dependency installation is required for building the package.

```sh
npm run build       # build static and dynamic bundles
npm test            # build and run notification, session, and client regressions
node tests/stress-host.mjs
```

The distributable static files are generated in `lib/`; the dynamic fallback is in `dynamic/`. After changing source, rebuild and commit the generated artifacts alongside it. During development, do not edit files directly inside an installed DSH profile.

## License

[MIT](LICENSE)
