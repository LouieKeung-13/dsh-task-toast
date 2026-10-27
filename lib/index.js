/**
 * dsh-task-toast — Host half (Node runtime / main process)
 * ------------------------------------------------------------------
 * Responsibilities:
 *   1. Subscribe to Cordis domain events that signal "a task has finished".
 *   2. Normalize each completion into a localized notification envelope and enqueue it.
 *   3. Expose a lightweight HTTP channel (long-poll + control routes) so the
 *      web/WebView client half can consume notifications without a build step.
 *
 * Design notes:
 *   - The queue is bounded and the long-poll waiter pool is capped; both are
 *     drained on disposal to avoid leaking sockets across plugin restarts.
 *   - Config is validated on write (`normalizeConfig`) so a malformed payload
 *     from the client can never corrupt host state.
 *   - `locale` selects the UI language used when generating envelope text on the
 *     host side (en / zh); the client mirrors this for its own chrome strings.
 */

const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const CLICK_ACTIONS = ['navigate', 'expand']
const LOCALES = ['en', 'zh']

const DEFAULT_CONFIG = {
  enabled: true,
  position: 'bottom-right',
  clickAction: 'navigate',
  showBody: true,
  locale: 'zh',
}

// Host-side i18n for dynamically generated envelope text.
const HOST_I18N = {
  en: {
    completed: 'Task completed',
    subagent: (id) => `Sub-agent ${id || ''} has completed.`,
    job: (label) => `Background job "${label}" has completed.`,
    workflow: () => 'Workflow subtask completed.',
    session: () => 'Session task round finished.',
    testTitle: 'Test · Task completed',
    testBody: 'This is a test notification used to verify the overlay channel.',
  },
  zh: {
    completed: '任务完成',
    subagent: (id) => `子代理 ${id || ''} 已完成`,
    job: (label) => `后台任务「${label}」已完成`,
    workflow: () => '工作流子任务完成',
    session: () => '会话任务已结束',
    testTitle: '测试 · 任务完成',
    testBody: '这是一条测试通知，用于验证提示窗口链路。',
  },
}

// Hard limits — keep memory and socket usage predictable.
const MAX_QUEUE = 100
const MAX_WAITERS = 64
const WAIT_MS = 15000

/**
 * Coerce an arbitrary inbound object into a valid config shape.
 * Any unknown / out-of-range value falls back to the default.
 */
function normalizeConfig(input) {
  const src = (input && typeof input === 'object') ? input : {}
  const pos = POSITIONS.indexOf(src.position) >= 0 ? src.position : DEFAULT_CONFIG.position
  const act = CLICK_ACTIONS.indexOf(src.clickAction) >= 0 ? src.clickAction : DEFAULT_CONFIG.clickAction
  const loc = LOCALES.indexOf(src.locale) >= 0 ? src.locale : DEFAULT_CONFIG.locale
  return {
    enabled: src.enabled === undefined ? DEFAULT_CONFIG.enabled : src.enabled !== false,
    position: pos,
    clickAction: act,
    showBody: src.showBody === undefined ? DEFAULT_CONFIG.showBody : src.showBody !== false,
    locale: loc,
  }
}

export default {
  name: 'dsh-task-toast',
  inject: ['timer', 'webServer'],
  apply(ctx) {
    /** @type {Array<{seq:number,sessionId:?string,title:string,body:string}>} */
    const queue = []
    /** @type {Array<{settled:boolean,res:any,dispose:?Function,resolve:Function}>} */
    const waiters = []
    const titleCache = new Map()
    const lastStatus = new Map() // sessionId -> last agent status (for the running→idle transition)
    let seq = 0
    let disposed = false
    let config = normalizeConfig(DEFAULT_CONFIG)

    // Active host-side translation bundle, resolved from config.locale.
    const t = () => HOST_I18N[config.locale === 'zh' ? 'zh' : 'en']

    // ---- HTTP helpers -----------------------------------------------------
    function sendJson(res, code, obj) {
      try {
        const body = JSON.stringify(obj)
        res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
        res.end(body)
      } catch (_) { /* socket already closed — nothing to do */ }
    }

    function readJson(req) {
      return new Promise((resolve) => {
        let data = ''
        req.on('data', (chunk) => {
          data += chunk
          if (data.length > 65536) { req.destroy(); resolve(null) } // guard against abusive payloads
        })
        req.on('end', () => { try { resolve(JSON.parse(data || '{}')) } catch (_) { resolve(null) } })
        req.on('error', () => resolve(null))
      })
    }

    /** Push one envelope and immediately release any suspended long-poll waiters. */
    function notify(sessionId, title, body) {
      if (disposed || !config.enabled) return
      const item = {
        seq: ++seq,
        sessionId: sessionId || null,
        title: String(title || t().completed).slice(0, 120),
        body: String(body || '').slice(0, 400),
      }
      queue.push(item)
      if (queue.length > MAX_QUEUE) queue.shift()
      while (waiters.length) {
        const w = waiters.shift()
        try { if (w.dispose) w.dispose() } catch (_) { /* ignore */ }
        try { w.resolve({ items: [item], seq }) } catch (_) { /* ignore */ }
      }
    }

    /** Best-effort resolution of a human-readable session title for the envelope. */
    async function resolveTitle(sessionId) {
      if (!sessionId || disposed) return undefined
      if (titleCache.has(sessionId)) return titleCache.get(sessionId)
      const sessionQuery = ctx.get('sessionQuery')
      if (!sessionQuery || typeof sessionQuery.readTitle !== 'function') return undefined
      try {
        const snapshot = await sessionQuery.readTitle(sessionId)
        const tt = snapshot && typeof snapshot.title === 'string' ? snapshot.title : undefined
        if (tt) titleCache.set(sessionId, tt)
        return tt
      } catch (_) { return undefined }
    }

    function enqueueWithTitle(sessionId, makeTitle, makeBody) {
      resolveTitle(sessionId)
        .then((title) => notify(sessionId, makeTitle(title), makeBody(title)))
        .catch(() => { /* swallow — title resolution is best-effort */ })
    }

    const titleFor = (title) => (title ? `${t().completed} · ${title}` : t().completed)

    // ---- HTTP channel -----------------------------------------------------
    const BASE = '/dsh-task-toast'
    ctx.webServer.register({ kind: 'exact', path: `${BASE}/state`, handler: (req, res) => {
      if (req.method !== 'GET') { sendJson(res, 405, { ok: false }); return }
      sendJson(res, 200, { config })
    }})
    ctx.webServer.register({ kind: 'exact', path: `${BASE}/config`, handler: async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
      const payload = await readJson(req)
      config = normalizeConfig(payload && payload.config)
      sendJson(res, 200, { ok: true, config })
    }})
    ctx.webServer.register({ kind: 'exact', path: `${BASE}/test`, handler: (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
      const item = { seq: ++seq, sessionId: null, title: t().testTitle, body: t().testBody }
      queue.push(item)
      if (queue.length > MAX_QUEUE) queue.shift()
      while (waiters.length) {
        const w = waiters.shift()
        try { if (w.dispose) w.dispose() } catch (_) { /* ignore */ }
        try { w.resolve({ items: [item], seq }) } catch (_) { /* ignore */ }
      }
      sendJson(res, 200, { ok: true })
    }})
    ctx.webServer.register({ kind: 'exact', path: `${BASE}/poll`, handler: (req, res) => {
      if (req.method !== 'GET') { sendJson(res, 405, { ok: false }); return }
      let since = 0
      try {
        const url = new URL(req.url, 'http://localhost')
        since = Number(url.searchParams.get('since')) || 0
      } catch (_) { /* ignore */ }

      const pending = queue.filter((i) => i.seq > since)
      if (pending.length) { sendJson(res, 200, { items: pending, seq }); return }
      if (waiters.length >= MAX_WAITERS || disposed) { sendJson(res, 200, { items: [], seq }); return }

      const w = { settled: false, res, dispose: null, resolve: null }
      w.resolve = (value) => {
        if (w.settled) return
        w.settled = true
        const idx = waiters.indexOf(w)
        if (idx >= 0) waiters.splice(idx, 1)
        try { if (w.dispose) w.dispose() } catch (_) { /* ignore */ }
        sendJson(w.res, 200, value)
      }
      // Hold the connection open until an event arrives or the timeout fires.
      w.dispose = ctx.timer.timeout(() => w.resolve({ items: [], seq }), WAIT_MS)
      req.on('close', () => w.resolve({ items: [], seq }))
      waiters.push(w)
    }})

    // ---- Domain-event subscriptions ---------------------------------------
    // 1) Sub-agent finished successfully.
    ctx.on('subagent/end', (info) => {
      try {
        if (!info || info.stopReason !== 'completed') return
        const sessionId = info.id
        enqueueWithTitle(sessionId, titleFor, () => t().subagent(sessionId))
      } catch (_) { /* ignore */ }
    })

    // 2) Background job (jobs.onJobDone) completed.
    const jobs = ctx.get('jobs')
    if (jobs && typeof jobs.onJobDone === 'function') {
      ctx.effect(() => jobs.onJobDone((snapshot, owner) => {
        try {
          if (!snapshot || snapshot.status !== 'completed') return
          const sessionId = snapshot.ownerSession || (owner && owner.id)
          const label = typeof snapshot.label === 'string' ? snapshot.label : 'background job'
          enqueueWithTitle(sessionId, titleFor, () => t().job(label))
        } catch (_) { /* ignore */ }
      }))
    }

    // 3) Workflow child agent completed.
    ctx.on('workflow/agent-end', (info, agent) => {
      try {
        if (!agent || agent.outcome !== 'completed') return
        const childId = agent.childId
        enqueueWithTitle(childId, titleFor, () => t().workflow())
      } catch (_) { /* ignore */ }
    })

    // 4) Top-level session transitioned running -> idle (one task round done).
    ctx.on('agent/status', (payload) => {
      try {
        if (!payload || !payload.agent) return
        const id = payload.agent.id
        const status = payload.status
        const prev = lastStatus.get(id)
        lastStatus.set(id, status)
        if (prev === 'running' && status === 'idle') {
          enqueueWithTitle(id, titleFor, () => t().session())
        }
      } catch (_) { /* ignore */ }
    })

    // ---- Lifecycle --------------------------------------------------------
    ctx.effect(() => {
      return () => {
        disposed = true
        while (waiters.length) {
          const w = waiters.shift()
          try { if (w.dispose) w.dispose() } catch (_) { /* ignore */ }
          try { w.resolve({ items: [], seq }) } catch (_) { /* ignore */ }
        }
      }
    })
  },
}
