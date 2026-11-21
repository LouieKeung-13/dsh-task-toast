// Browser APIs are shared by the desktop renderer and the standalone Web GUI.
export function systemNotificationPermission(NotificationApi = globalThis.Notification) {
  try {
    if (typeof NotificationApi !== 'function') return 'unsupported'
    const permission = NotificationApi.permission
    return permission === 'granted' || permission === 'denied' || permission === 'default'
      ? permission : 'unsupported'
  } catch {
    return 'unsupported'
  }
}

const SOUND_PATTERNS = {
  soft: [[660, 0, 0.24, 0.09]],
  clear: [[880, 0, 0.13, 0.13], [1320, 0.10, 0.19, 0.10]],
}

const SOUND_PREFERENCE_KEY = 'dsh-task-toast:sound-cues'

export function readSoundPreference(fallback) {
  try {
    const saved = globalThis.localStorage?.getItem(SOUND_PREFERENCE_KEY)
    if (saved === 'off' || saved === 'soft' || saved === 'clear') return saved
  } catch { /* Storage may be disabled by the browser. */ }
  return fallback
}

export function saveSoundPreference(level) {
  try { globalThis.localStorage?.setItem(SOUND_PREFERENCE_KEY, level) } catch { /* Keep the setting in memory. */ }
}

export function isTaskSoundItem(item) {
  return item.category === 'task' || item.category === 'test'
}

function scheduleTone(context, frequency, start, duration, peak) {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(frequency, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.018)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
  oscillator.start(start)
  oscillator.stop(start + duration + 0.015)
}

export function createTaskSoundPlayer(AudioContextApi = globalThis.AudioContext || globalThis.webkitAudioContext) {
  let context
  let disposed = false
  const played = new Set()

  // Resume only on user interaction. Never queue background audio to replay on the next interaction.
  async function unlock() {
    if (disposed || typeof AudioContextApi !== 'function') return false
    try {
      context ??= new AudioContextApi()
      if (context.state !== 'running') await context.resume()
      return !disposed && context.state === 'running'
    } catch { return false }
  }

  function play(level) {
    if (level !== 'soft' && level !== 'clear') return false
    if (disposed || context?.state !== 'running') return false
    try {
      const start = context.currentTime + 0.015
      for (const [frequency, delay, duration, peak] of SOUND_PATTERNS[level]) {
        scheduleTone(context, frequency, start + delay, duration, peak)
      }
      return true
    } catch { return false }
  }

  return {
    unlock,
    async preview(level, isCurrent = () => true) {
      if (level !== 'soft' && level !== 'clear') return false
      return await unlock() && isCurrent() && play(level)
    },
    notify(item, config) {
      if (item.silent || !isTaskSoundItem(item) || !config.enabled || (item.category === 'task' && config.categories.task === 'off')) return false
      const key = item.replaceSeq ?? item.seq
      if (played.has(key) || !play(config.soundCues)) return false
      played.add(key)
      if (played.size > 200) played.delete(played.values().next().value)
      return true
    },
    dispose() {
      disposed = true
      context?.close().catch(() => {})
      played.clear()
    },
  }
}

// Call directly from a click handler. Browsers can reject background permission prompts.
export async function requestSystemNotificationPermission(NotificationApi = globalThis.Notification) {
  const existing = systemNotificationPermission(NotificationApi)
  if (existing !== 'default' || typeof NotificationApi?.requestPermission !== 'function') return existing
  try {
    await NotificationApi.requestPermission()
  } catch {
    return systemNotificationPermission(NotificationApi)
  }
  return systemNotificationPermission(NotificationApi)
}

// The Session controller owns data; uiWorkspace owns the visible conversation.
export async function openNotificationSession(sessionId, uiWorkspace, legacySessions) {
  if (!sessionId) return false
  try {
    if (typeof uiWorkspace?.openSession === 'function') {
      const result = await uiWorkspace.openSession(sessionId)
      if (result === false) return false
      if (typeof uiWorkspace.selection?.getSnapshot === 'function') return uiWorkspace.selection.getSnapshot()?.sessionId === sessionId
      return true
    }
    if (typeof legacySessions?.open === 'function') return await legacySessions.open(sessionId) !== false
  } catch { /* Report failure to the caller rather than pretending navigation succeeded. */ }
  return false
}

export function watchNotificationSelection(uiWorkspace, reportForeground) {
  const selection = uiWorkspace?.selection
  if (typeof selection?.getSnapshot !== 'function' || typeof selection?.subscribe !== 'function') return () => {}
  let current
  let stop = () => {}
  const refresh = () => {
    const next = selection.getSnapshot()?.sessionId || null
    if (current === next) return
    stop()
    current = next
    stop = reportForeground(next)
  }
  const unsubscribe = selection.subscribe(refresh)
  refresh()
  return () => { unsubscribe(); stop() }
}

export function systemNotificationExcerpt(item, showSummary = true) {
  if (!showSummary) return ''
  const text = String(item.body || '')
    .replace(/\[([^\]]+)\]\([^\r\n)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*|__|\x60/g, '')
    .replace(/\s+/g, ' ').trim()
  return text.length > 240 ? text.slice(0, 239) + '…' : text
}

const retainedSystemNotifications = new Set()

export function deliverSystemNotification(item, { onOpen, onFallback, onStatus, onNavigationFailure, showSummary = true, NotificationApi = globalThis.Notification }) {
  const permission = systemNotificationPermission(NotificationApi)
  if (permission !== 'granted') {
    onStatus(permission)
    onFallback()
    return
  }
  let settled = false
  function fail() {
    if (settled) return
    settled = true
    onStatus('failed')
    onFallback()
  }
  try {
    // The Host keeps replaceSeq stable for each burst. Reuse it as the OS tag where supported.
    const tag = 'dsh-tt-' + String(item.replaceSeq ?? item.seq)
    const options = { body: systemNotificationExcerpt(item, showSummary), tag, renotify: false }
    if (isTaskSoundItem(item)) options.silent = true
    const notification = new NotificationApi(item.title || 'DSH', options)
    retainedSystemNotifications.add(notification)
    if (retainedSystemNotifications.size > 200) retainedSystemNotifications.delete(retainedSystemNotifications.values().next().value)
    notification.onshow = () => { settled = true }
    notification.onerror = () => { retainedSystemNotifications.delete(notification); fail() }
    notification.onclick = async () => {
      settled = true
      try { globalThis.window?.focus?.() } catch { /* The host may deny programmatic focus. */ }
      try {
        if (item.sessionId && await onOpen(item.sessionId) === false) {
          onStatus('navigation-failed')
          onNavigationFailure?.()
        }
      } catch {
        onStatus('navigation-failed')
        onNavigationFailure?.()
      } finally {
        retainedSystemNotifications.delete(notification)
        notification.close()
      }
    }
    onStatus('submitted')
  } catch {
    fail()
  }
}

export function createForegroundReporter(send) {
  const clientId = globalThis.crypto?.randomUUID?.() ?? 'toast-' + Date.now() + '-' + Math.random().toString(36).slice(2)
  let pending = null
  let sending = false
  async function flush() {
    if (sending) return
    sending = true
    try {
      while (pending) {
        const report = pending
        pending = null
        try { await send(report) } catch { /* A later focus event or heartbeat retries. */ }
      }
    } finally {
      sending = false
    }
  }
  return (sessionId, { win = globalThis.window, doc = globalThis.document } = {}) => {
    if (!win || !doc) return () => {}
    const report = (foreground) => {
      pending = { clientId, sessionId: sessionId || null, foreground: !!sessionId && foreground }
      void flush()
    }
    const refresh = () => report(doc.visibilityState === 'visible' && doc.hasFocus())
    const blur = () => report(false)
    win.addEventListener('focus', refresh)
    win.addEventListener('blur', blur)
    win.addEventListener('pagehide', blur)
    win.addEventListener('pageshow', refresh)
    doc.addEventListener('visibilitychange', refresh)
    const interval = win.setInterval(refresh, 10000)
    refresh()
    return () => {
      win.clearInterval(interval)
      win.removeEventListener('focus', refresh)
      win.removeEventListener('blur', blur)
      win.removeEventListener('pagehide', blur)
      win.removeEventListener('pageshow', refresh)
      doc.removeEventListener('visibilitychange', refresh)
      blur()
    }
  }
}
