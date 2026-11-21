// src/host.js
// dsh-task-toast —— Host 半（DSH Node 进程，动态插件形态）。
//
// 监听任务完成 / 错误等需要提示的事件 → 按设置页下发的配置过滤 → 入队 →
// 通过 tt/poll 长轮询推送给 Client（页面里的动态 client 模块）。
// 事件来源与 dsh-session-notify 一致，作用域为当前会话及其子代理。
//
// 作为动态插件使用时，请粘贴构建产物 dynamic/host.body.js（npm run build:dynamic），
// 或直接把本文件 export default 的对象字面量作为 cordis_define 的 code.host 函数体。
import { CATEGORY_KEYS, DEFAULT_CONFIG, normalizeConfig } from './config.js'

// 多语言文案（标题 / 正文随 config.locale 切换）。
const I18N = {
  zh: {
    taskDone: (s) => (s ? '任务完成 · ' + s : '任务完成'),
    taskDoneBody: (s) => (s ? '会话「' + s + '」的任务已完成' : '会话任务已完成'),
    error: (s) => (s ? '任务出错 · ' + s : '任务出错'),
    errorBody: (s) => (s ? '会话「' + s + '」执行出错' : '会话执行出错'),
    testTitle: '测试通知',
    testBody: '这是一条来自任务提示插件的测试消息，用于验证通知链路。',
  },
  en: {
    taskDone: (s) => (s ? 'Task completed · ' + s : 'Task completed'),
    taskDoneBody: (s) => (s ? 'Task in “' + s + '” finished' : 'Session task finished'),
    error: (s) => (s ? 'Task failed · ' + s : 'Task failed'),
    errorBody: (s) => (s ? 'Task in “' + s + '” failed' : 'Session task failed'),
    testTitle: 'Test notification',
    testBody: 'This is a test message from the task-toast plugin, used to verify the pipeline.',
  },
}
function i18n(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : DEFAULT_CONFIG
  return I18N[c.locale === 'en' ? 'en' : 'zh']
}

export default {
  inject: ['timer'],
  apply(ctx) {
    const queue = []
    const waiters = []
    const titleCache = new Map()
    let seq = 0
    let disposed = false
    const activeClients = new Map() // clientId -> { sessionId, foreground, at }
    let legacyActiveSession = null // session-only clients keep the old same-session behavior
    const ACTIVE_CLIENT_TTL_MS = 30000
    const streamingSessions = new Set()
    const MAX_QUEUE = 200
    const MAX_WAITERS = 32
    const WAIT_MS = 15000
    // 突发合并：同一会话 / 同分类在窗口内的连续通知合并为一条（显示 ×N 计数），避免子代理并发刷屏
    const GROUP_WINDOW_MS = 60 * 1000
    const groupBuf = new Map()

    let config = normalizeConfig(DEFAULT_CONFIG)

    // ---------- 通知历史（供「通知中心」回看；动态插件形态下为内存态，重启即清空） ----------
    // 说明：动态宿主由 build-dynamic 剥离 import 后内联运行，无法稳定依赖 node:fs，
    // 因此这里用内存数组承装历史；桌面静态版（lib/index.js）才有落盘持久化。
    const memHistory = []
    function loadHistory() { return memHistory.slice() }
    function recordHistory(item) {
      try {
        memHistory.unshift({ seq: item.seq, category: item.category, sessionId: item.sessionId, title: item.title, body: item.body, ts: Date.now() })
        if (memHistory.length > 200) memHistory.length = 200
      } catch (e) { /* ignore */ }
    }
    function clearHistory() { memHistory.length = 0 }

    function pruneActiveClients(now) {
      for (const [clientId, focus] of activeClients) {
        if (now - focus.at >= ACTIVE_CLIENT_TTL_MS) activeClients.delete(clientId)
      }
    }

    function updateActiveClient(args) {
      const body = args && typeof args === 'object' ? args : {}
      const clientId = typeof body.clientId === 'string' && body.clientId && body.clientId.length <= 128
        ? body.clientId
        : null
      const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : null
      const foreground = typeof body.foreground === 'boolean' ? body.foreground : true
      const now = Date.now()
      pruneActiveClients(now)
      if (!clientId) {
        legacyActiveSession = sessionId
        return sessionId
      }
      if (sessionId) {
        activeClients.delete(clientId)
        if (activeClients.size >= 128) {
          const oldest = activeClients.keys().next().value
          if (oldest !== undefined) activeClients.delete(oldest)
        }
        activeClients.set(clientId, { sessionId: sessionId, foreground: foreground, at: now })
      } else activeClients.delete(clientId)
      return sessionId
    }

    function snapshotFocus(sessionId) {
      pruneActiveClients(Date.now())
      let foreground = !!(sessionId && legacyActiveSession === sessionId)
      if (sessionId) {
        for (const focus of activeClients.values()) {
          if (focus.foreground && focus.sessionId === sessionId) { foreground = true; break }
        }
      }
      return { foreground: foreground, running: !!(sessionId && streamingSessions.has(sessionId)) }
    }

    function clearStreamingSession(sessionId) {
      const focus = snapshotFocus(sessionId)
      if (sessionId) streamingSessions.delete(sessionId)
      return focus
    }

    /** 入队一条通知（已按配置过滤），并唤醒所有挂起的长轮询等待者。 */
    function notify(category, sessionId, title, body, focusAtEvent) {
      if (disposed || !config.enabled) return
      const level = config.categories[category]
      if (!level || level === 'off') return
      const focus = focusAtEvent || snapshotFocus(sessionId)
      const suppressForStreaming = focus.foreground && focus.running
      if (config.onlyOtherSessions && focus.foreground && !suppressForStreaming) return
      const now = Date.now()
      const key = category + '|' + (sessionId || '')
      const g = groupBuf.get(key)
      let replaceSeq = null
      let groupCount = 1
      if (g && now - g.at < GROUP_WINDOW_MS) {
        replaceSeq = g.seq
        groupCount = g.count + 1
        g.at = now
        g.count = groupCount
      }
      const item = {
        seq: ++seq,
        category: category,
        sessionId: sessionId || null,
        title: String(title || '通知').slice(0, 120),
        body: String(body || '').slice(0, 4000),
        replaceSeq: replaceSeq,
        groupCount: groupCount,
      }
      if (level === 'system') item.delivery = 'system'
      if (!replaceSeq) groupBuf.set(key, { seq: item.seq, at: now, count: 1 })
      else if (groupBuf.size > 200) {
        for (const [k, v] of groupBuf) if (now - v.at > GROUP_WINDOW_MS) groupBuf.delete(k)
      }
      recordHistory(item)
      if (suppressForStreaming) return
      queue.push(item)
      if (queue.length > MAX_QUEUE) queue.shift()
      while (waiters.length) {
        const w = waiters.shift()
        try { if (w.dispose) w.dispose() } catch (e) { /* ignore */ }
        try { w.resolve({ items: [item], seq: seq }) } catch (e) { /* ignore */ }
      }
    }

    /** 读取会话标题用于通知文案（带进程内缓存，失败静默降级）。 */
    async function readTitle(sessionId) {
      if (!sessionId || disposed) return undefined
      if (titleCache.has(sessionId)) return titleCache.get(sessionId)
      const sessionQuery = ctx.get('sessionQuery')
      if (!sessionQuery || typeof sessionQuery.readTitle !== 'function') return undefined
      try {
        const snap = await sessionQuery.readTitle(sessionId)
        const t = snap && typeof snap.title === 'string' ? snap.title : undefined
        if (t) titleCache.set(sessionId, t)
        return t
      } catch (e) {
        return undefined
      }
    }

    function safeMessage(err) {
      if (err == null) return '未知错误'
      if (typeof err === 'string') return err
      if (err instanceof Error) return err.message || '未知错误'
      try { return String(err) } catch (e) { return '未知错误' }
    }

    const SUMMARY_MAX_CHARS = 4000
    const SUMMARY_READ_TIMEOUT_MS = 1000

    function messageText(message) {
      if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return ''
      return message.content
        .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('')
        .trim()
    }

    function excerptText(text) {
      const value = typeof text === 'string' ? text.trim() : ''
      return value ? value.slice(-SUMMARY_MAX_CHARS) : ''
    }

    function hasToolCall(message) {
      if (Array.isArray(message && message.tool_calls) && message.tool_calls.length) return true
      return !!(message && Array.isArray(message.content) && message.content.some((block) => block && (block.type === 'tool-call' || block.type === 'tool_call')))
    }

    function latestAssistantText(messages) {
      if (!Array.isArray(messages)) return ''
      let lastUser = -1
      for (let i = 0; i < messages.length; i += 1) {
        if (messages[i] && messages[i].role === 'user') lastUser = i
      }
      for (let i = messages.length - 1; i > lastUser; i -= 1) {
        const message = messages[i]
        if (!message || message.role !== 'assistant') continue
        if (hasToolCall(message)) return ''
        return excerptText(messageText(message))
      }
      return ''
    }

    async function readSummary(sessionId) {
      if (!sessionId || disposed || !config.showSummary) return ''
      try {
        const sessions = ctx.get('sessions')
        const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
        if (session && typeof session.deriveMessages === 'function') {
          const messages = await Promise.resolve(session.deriveMessages())
          const text = latestAssistantText(messages)
          if (text) return text
        }
      } catch (e) { /* fall through to the read-only surface API */ }
      try {
        const sessionQuery = ctx.get('sessionQuery')
        if (!sessionQuery || typeof sessionQuery.readSurface !== 'function') return ''
        const snap = await sessionQuery.readSurface(sessionId)
        const events = snap && Array.isArray(snap.events) ? snap.events : []
        const messages = events.map((event) => {
          if (!event) return null
          if (event.type === 'user/message') return event.data
          if (event.type === 'assistant/message') return event.data && event.data.message
          return null
        })
        return latestAssistantText(messages)
      } catch (e) { /* summary is optional; retain the generic notification */ }
      return ''
    }

    function boundedRead(fn, fallback) {
      return new Promise((resolve) => {
        let settled = false
        const finish = (value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(value)
        }
        const timer = setTimeout(() => finish(fallback), SUMMARY_READ_TIMEOUT_MS)
        Promise.resolve().then(fn).then(finish, () => finish(fallback))
      })
    }

    function appendSummary(body, summary) {
      const base = String(body || '').slice(0, SUMMARY_MAX_CHARS)
      const extra = excerptText(summary)
      if (!extra) return base
      const separator = base ? '\n\n' : ''
      const available = Math.max(0, SUMMARY_MAX_CHARS - base.length - separator.length)
      return base + separator + (available > 0 ? extra.slice(-available) : '')
    }

    /** 异步读取标题和可选结果摘要，超时则保留通用文案。 */
    function enqueueAfterTitle(category, sessionId, makeTitle, makeBody, focusAtEvent, includeSummary) {
      const focus = focusAtEvent || snapshotFocus(sessionId)
      const titleRead = boundedRead(() => readTitle(sessionId), undefined)
      const summaryRead = includeSummary && config.showSummary
        ? boundedRead(() => readSummary(sessionId), '')
        : Promise.resolve('')
      Promise.all([titleRead, summaryRead]).then(([title, summary]) => {
        const body = includeSummary ? appendSummary(makeBody(title), summary) : makeBody(title)
        notify(category, sessionId, makeTitle(title), body, focus)
      }).catch(() => { /* ignore */ })
    }

    // ---------- RPC（Client -> Host，方向固定） ----------
    harness.handle('tt/state', () => ({ config: config }))

    harness.handle('tt/config', (args) => {
      config = normalizeConfig(args && args.config)
      return { ok: true, config: config }
    })

    harness.handle('tt/active', (args) => {
      const activeSession = updateActiveClient(args)
      return { ok: true, activeSession: activeSession }
    })

    harness.handle('tt/poll', (args) => new Promise((resolve) => {
      const since = args && typeof args.since === 'number' ? args.since : 0
      const pending = queue.filter((i) => i.seq > since)
      if (pending.length) {
        resolve({ items: pending, seq: seq })
        return
      }
      if (waiters.length >= MAX_WAITERS || disposed) {
        resolve({ items: [], seq: seq })
        return
      }
      const w = { settled: false, resolve: null, dispose: null }
      w.resolve = (value) => {
        if (w.settled) return
        w.settled = true
        const idx = waiters.indexOf(w)
        if (idx >= 0) waiters.splice(idx, 1)
        try { if (w.dispose) w.dispose() } catch (e) { /* ignore */ }
        resolve(value)
      }
      w.dispose = ctx.timer.timeout(() => {
        w.resolve({ items: [], seq: seq })
      }, WAIT_MS)
      waiters.push(w)
    }))

    harness.handle('tt/test', (args) => {
      const t = i18n(config)
      const system = config.categories.task === 'system'
      const sessionId = args && typeof args.sessionId === 'string' && args.sessionId.length <= 200
        ? args.sessionId || null
        : null
      const item = {
        seq: ++seq,
        category: 'test',
        sessionId: sessionId,
        title: t.testTitle,
        body: t.testBody,
      }
      if (system) item.delivery = 'system'
      queue.push(item)
      if (queue.length > MAX_QUEUE) queue.shift()
      while (waiters.length) {
        const w = waiters.shift()
        try { if (w.dispose) w.dispose() } catch (e) { /* ignore */ }
        try { w.resolve({ items: [item], seq: seq }) } catch (e) { /* ignore */ }
      }
      return system ? { ok: true, mode: 'system', queued: true } : { ok: true }
    })

    // 通知中心：拉取 / 清空历史（持久化于本地文件，重启不丢）
    harness.handle('tt/history', () => ({ ok: true, items: loadHistory() }))
    harness.handle('tt/history/clear', () => { clearHistory(); return { ok: true } })

    // ---------- 事件源 ----------
    // 任务完成：subagent/end（completed）
    ctx.on('subagent/end', (info) => {
      try {
        const sessionId = info && info.id ? info.id : undefined
        const stop = info && info.stopReason
        if (stop === 'completed') {
          const focusAtEvent = snapshotFocus(sessionId)
          const t = i18n(config)
          enqueueAfterTitle('task', sessionId, (s) => t.taskDone(s), (s) => t.taskDoneBody(s), focusAtEvent, true)
        } else if (stop === 'error') {
          const focusAtEvent = snapshotFocus(sessionId)
          const t = i18n(config)
          enqueueAfterTitle('error', sessionId, (s) => t.error(s), (s) => t.errorBody(s), focusAtEvent)
        }
      } catch (e) { console.error(e) }
    })

    // 任务完成：workflow/agent-end（completed / failed）
    ctx.on('workflow/agent-end', (info, agent) => {
      try {
        const childId = agent && agent.childId ? agent.childId : undefined
        const outcome = agent && agent.outcome
        if (outcome === 'completed') {
          const focusAtEvent = snapshotFocus(childId)
          const t = i18n(config)
          enqueueAfterTitle('task', childId, (s) => t.taskDone(s), (s) => t.taskDoneBody(s), focusAtEvent, true)
        } else if (outcome === 'failed') {
          const focusAtEvent = snapshotFocus(childId)
          const t = i18n(config)
          enqueueAfterTitle('error', childId, (s) => t.error(s), (s) => t.errorBody(s), focusAtEvent)
        }
      } catch (e) { console.error(e) }
    })

    // 任务完成：会话自身 running -> idle
    ctx.on('agent/status', (payload) => {
      try {
        if (!payload) return
        const sessionId = payload.agent ? payload.agent.id : undefined
        if (sessionId && payload.status === 'running') streamingSessions.add(sessionId)
        else if (payload.status === 'idle') {
          const focusAtEvent = clearStreamingSession(sessionId)
          const t = i18n(config)
          enqueueAfterTitle('task', sessionId, (s) => t.taskDone(s), (s) => t.taskDoneBody(s), focusAtEvent, true)
          return
        }
        if (payload.status !== 'idle') return
      } catch (e) { console.error(e) }
    })

    // 后台任务：jobs.onJobDone（completed / failed）
    const jobs = ctx.get('jobs')
    if (jobs && typeof jobs.onJobDone === 'function') {
      ctx.effect(() => jobs.onJobDone((snapshot, owner) => {
        try {
          const sessionId = (snapshot && snapshot.ownerSession) || (owner && owner.id) || undefined
          const label = snapshot && typeof snapshot.label === 'string' ? snapshot.label : '后台任务'
          const status = snapshot && snapshot.status
          const t = i18n(config)
          if (status === 'failed') {
            const focusAtEvent = snapshotFocus(sessionId)
            enqueueAfterTitle('error', sessionId, (s) => t.error(s), () => t.errorBody(label), focusAtEvent)
          } else if (status === 'completed') {
            const focusAtEvent = snapshotFocus(sessionId)
            enqueueAfterTitle('task', sessionId, (s) => t.taskDone(s), () => t.taskDoneBody(label), focusAtEvent)
          }
        } catch (e) { /* ignore */ }
      }))
    }

    // 会话出错：agent/error
    ctx.on('agent/error', (payload) => {
      try {
        const sessionId = payload && payload.agent ? payload.agent.id : undefined
        const focusAtEvent = clearStreamingSession(sessionId)
        const t = i18n(config)
        enqueueAfterTitle('error', sessionId, (s) => t.error(s), () => t.errorBody(safeMessage(payload && payload.error)), focusAtEvent)
      } catch (e) { console.error(e) }
    })

    // 停止 / 更新时：结束所有挂起的长轮询，防止悬空 Promise
    ctx.effect(() => {
      return () => {
        disposed = true
        while (waiters.length) {
          const w = waiters.shift()
          try { if (w.dispose) w.dispose() } catch (e) { /* ignore */ }
          try { w.resolve({ items: [], seq: seq }) } catch (e) { /* ignore */ }
        }
      }
    })
  },
}
