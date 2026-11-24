# dsh-task-toast

[简体中文](README.zh.md)

Task-completion notifications for [DeepSeek Harness](https://www.deepseek.com/harness/). Get a concise result preview and open the conversation that produced it, even when the Windows Desktop window is minimized or hidden in the system tray.

## Features

- **System notifications** on supported Windows and macOS clients, with an in-app fallback when delivery is unavailable. Task-completion alerts use the selected cue when it plays; otherwise the OS alert sound is allowed. Error alerts keep the OS default sound.
- **Result previews** of up to 240 characters. Click a notification to open its source conversation; on Windows Desktop, a minimized or tray-hidden window is restored first.
- **In-app toasts** with View result, Later and Dismiss actions, plus local notification history.
- **Optional Soft and Clear sounds**. Selecting a sound previews it. If background audio is suspended, the plugin attempts to resume it; when it cannot, system notifications retain the OS notification sound instead of being silent.
- **Focus-aware delivery** that avoids interrupting a conversation currently being viewed while it is running.
- **Bilingual settings** (English and Simplified Chinese), themes, placement and dismissal controls.
- **Multiple task sources** including agents, workflows, background jobs and top-level sessions.
- **Updates managed by dshmarket**; the plugin does not overwrite installed files or run a package manager itself.

## Install

### DSH Desktop

Open **Plugins → Add plugin → Install third-party plugin**, then enter:

```text
https://github.com/LouieKeung-13/dsh-task-toast
```

Install and enable the plugin. The package includes prebuilt Host and Client files; installation does not require a local build step.

### DSH Web profile

```sh
dsh plugin --profile web add github:LouieKeung-13/dsh-task-toast
```

Use the target profile name in place of `web` where needed. The Desktop profile is managed by the Desktop app.

## Updates

The only intended marketplace channel is **dshmarket**. Market listing requires a separate catalog review; once listed, manage it through **Plugins → Plugin Market → Installed**. Automatic update checks can remind you about updates, but do not install them silently. A direct GitHub installation does not automatically switch to a market-managed installation source.

The updater and plugin-source changes are applied by DSH's existing Host/Client reload mechanisms when the Host reports that they applied. Follow the Host result if it asks you to refresh the page or restart DSH. The first migration from a pre-lifecycle-cleanup build still requires one complete restart to clear stale routes left by that older process.

## Quick start

1. Open **Settings → Task notifications** and enable the plugin.
2. Set **Task completed** to **System notification** and allow notification permission when prompted.
3. Leave **Show result summary** enabled for a short result preview. Disable it if task output may contain sensitive information; the OS may show notification text on the lock screen.
4. Choose **Soft** or **Clear** under **Task completion sound**. Selecting a cue previews it; the Preview button can replay it.
5. Use a real background task to check result previews and session navigation end to end. The test notification contains no real task result.

The selected sound cue is remembered in browser storage. Other notification settings and queues are held by the running Host process; after fully exiting DSH, check and set them again.

## Notification behavior

| Setting | Behavior |
| --- | --- |
| **System notification** | Sends one OS notification. A denied permission, unsupported API or delivery failure falls back to one in-app toast. If the selected Web Audio cue cannot resume, the OS notification is allowed to use its own sound. |
| **In-app toast** | Shows the result and View result, Later and Dismiss actions inside DSH. |
| **Off** | Suppresses that notification category. |
| **Show result summary** | Uses plain assistant text from the latest answered user turn. Reasoning, tool-call/result content and older turns are excluded. |
| **Task completion sound** | Off, Soft or Clear. Sounds are synthesized locally. The selected cue is previewed on selection and retried when a task notification arrives; audio policies may prevent Web Audio in a background renderer. |

A system banner contains a short plain-text preview, not the full transcript. The body is capped at 240 characters including the completion text. The plugin does not render HTML or execute result content. OS notification display, sound and retention are controlled by the client and operating system.

When a notification is generated for a conversation that is being viewed while it is still running, it is recorded in history without interrupting the user. Such suppressed notifications are not automatically replayed later.

On Windows Desktop, clicking a system notification or the View action on a floating card asks DSH to restore/show/focus its main window before selecting the notification's source session. DSH must still be running in the background; this does not relaunch a fully exited application. Other hosts use their own window and focus behavior.

## Settings

- **Task completed / Error** — Off, In-app toast or System notification per category.
- **View result** — navigate to the source session or expand the in-app toast.
- **Show result summary** and **Only other sessions** — control preview content and focused-session filtering.
- **Task completion sound** — Off, Soft or Clear, with Preview and Mute controls.
- **Notification presentation** — optional floating card or window helper; support and actions vary by platform. This setting is separate from the system notification channel.
- **Appearance and history** — position, theme, language, auto-dismiss and a local notification history. Static Desktop Host history keeps at most 200 entries; dynamic-plugin history is in memory.

## Troubleshooting

### The settings panel goes blank after selecting a floating card

The Settings render no longer reads a stale update-state object when Card is selected. The Settings panel must remain renderable when Card, Window or Off is selected. If an older Client is still cached, follow the Host activation result and refresh or restart as requested.

### A task notification has no sound

- Selecting Soft or Clear previews the cue. If preview fails, check the DSH audio output and try Preview while the application is foregrounded.
- An operating system or browser may suspend background Web Audio. The plugin tries to resume the unlocked context at task completion. If that fails on the System notification channel, it permits the OS notification sound as a fallback; that fallback uses the OS-selected sound, not the custom cue.
- The System channel must have notification permission. OS Focus Assist / Do Not Disturb and per-app sound settings also apply.
- For an In-app toast, an OS sound fallback is not available; return DSH to the foreground and use Preview to re-enable audio.

### Clicking a system notification does not open the conversation

Keep DSH running in the background. On Windows Desktop the plugin can restore a minimized or tray-hidden main window. Fully quitting DSH is outside this notification callback. Test with a newly generated real task notification.

### No notification arrives

Check the category level, the Host status in Settings and the operating-system notification permissions. Inspect the DSH process log and Client console for `[dsh-task-toast]` or `[task-toast]` errors.

## Uninstall

- **DSH Desktop:** use **Plugins → Installed plugins**.
- **DSH Web profile:**

  ```sh
  dsh plugin --profile web remove dsh-task-toast
  ```

## Development

Requirements: Node.js 18 or newer.

```sh
npm run build
npm test
node tests/stress-host.mjs
```

`lib/` contains the static installable build and `dynamic/` the dynamic fallback. Rebuild generated artifacts after changing source. Do not edit an installed DSH profile directly during development.

## License

[MIT](LICENSE)
