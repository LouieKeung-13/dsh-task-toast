// 由 scripts/build-dynamic.mjs 生成 —— 可直接作为 cordis_define 的 code.host 函数体。
// src/config.js
// dsh-task-toast —— 共享配置与纯函数（位置 / 语言 / 查看行为 / 分类级别 / 默认值 / 配置归一化）。
//
// ⚠️ 构建说明：build-static.mjs 会把本文件内容内联进 lib/client.js（去掉 export 关键字，
// 转为顶层 const/function）；build-dynamic.mjs 也会内联进 dynamic/*.body.js。
// 因此这里只能包含无任何运行时依赖的常量与函数（不能 import 其他模块、不能引用
// ctx / React / host 等宿主符号）。

/** 浮层弹出位置（四角可选）。 */
const POSITIONS = [
  { id: 'top-left', zh: '左上角', en: 'Top-left' },
  { id: 'top-right', zh: '右上角', en: 'Top-right' },
  { id: 'bottom-left', zh: '左下角', en: 'Bottom-left' },
  { id: 'bottom-right', zh: '右下角', en: 'Bottom-right' },
]
const POSITION_IDS = POSITIONS.map((p) => p.id)

/** 「查看结果」点击后的行为。 */
const VIEW_BEHAVIORS = [
  { id: 'navigate', zh: '跳转到会话', en: 'Navigate to session' },
  { id: 'expand', zh: '浮层内展开内容', en: 'Expand in overlay' },
]
const VIEW_BEHAVIOR_IDS = VIEW_BEHAVIORS.map((b) => b.id)

/** 界面语言。 */
const LOCALES = [
  { id: 'zh', zh: '中文（简体）', en: 'Chinese (Simplified)' },
  { id: 'en', zh: '英文', en: 'English' },
]
const LOCALE_IDS = LOCALES.map((l) => l.id)

/** 通知分类：task = 任务完成（默认应用内提示）；error = 错误失败（默认关闭）。 */
const CATEGORIES = [
  { id: 'task', zh: '任务完成', en: 'Task completed', def: 'app' },
  { id: 'error', zh: '错误失败', en: 'Error', def: 'off' },
]
const CATEGORY_KEYS = CATEGORIES.map((c) => c.id)

/** 通知级别：off 关闭 / app 仅应用内 toast / system 系统通知 + toast。 */
const LEVELS = [
  { id: 'off', zh: '关闭', en: 'Off' },
  { id: 'app', zh: '应用内提示', en: 'In-app toast' },
  { id: 'system', zh: '系统通知', en: 'System notification' },
]
const LEVEL_IDS = LEVELS.map((l) => l.id)

/** 默认配置（与设置页首次打开时一致）。 */
const DEFAULT_CONFIG = {
  enabled: true,
  locale: 'zh',
  position: 'bottom-right',
  viewBehavior: 'navigate',
  showSummary: true,
  onlyOtherSessions: true,
  autoDismissMs: 10000,
  categories: {
    task: 'app',
    error: 'off',
  },
}

/** 仅接受合法级别，其余一律收敛为 'off'。 */
function sanitizeLevel(v) {
  return LEVEL_IDS.indexOf(v) >= 0 ? v : 'off'
}

/**
 * 把任意输入归一化为完整配置：
 * - 非对象输入按空对象处理；
 * - 显式声明且合法的字段保留，非法的收敛为默认值；
 * - 未声明的分类回退到 DEFAULT_CONFIG 的默认值。
 */
function normalizeConfig(input) {
  const src = input && typeof input === 'object' ? input : {}
  const cats = {}
  for (const k of CATEGORY_KEYS) {
    const v = src.categories && src.categories[k]
    cats[k] = v === undefined ? DEFAULT_CONFIG.categories[k] : sanitizeLevel(v)
  }
  return {
    enabled: src.enabled === undefined ? DEFAULT_CONFIG.enabled : src.enabled !== false,
    locale: LOCALE_IDS.indexOf(src.locale) >= 0 ? src.locale : DEFAULT_CONFIG.locale,
    position: POSITION_IDS.indexOf(src.position) >= 0 ? src.position : DEFAULT_CONFIG.position,
    viewBehavior: VIEW_BEHAVIOR_IDS.indexOf(src.viewBehavior) >= 0 ? src.viewBehavior : DEFAULT_CONFIG.viewBehavior,
    showSummary: src.showSummary === undefined ? DEFAULT_CONFIG.showSummary : src.showSummary !== false,
    onlyOtherSessions:
      src.onlyOtherSessions === undefined ? DEFAULT_CONFIG.onlyOtherSessions : src.onlyOtherSessions !== false,
    autoDismissMs:
      typeof src.autoDismissMs === 'number'
        ? Math.max(2000, Math.min(60000, src.autoDismissMs | 0))
        : DEFAULT_CONFIG.autoDismissMs,
    categories: cats,
  }
}

/** 深拷贝一份默认配置（避免共享引用被意外改写）。 */
function cloneDefaultConfig() {
  return normalizeConfig(DEFAULT_CONFIG)
}
// src/host.js
// dsh-task-toast —— Host 半（DSH Node 进程，动态插件形态）。
//
// 监听任务完成 / 错误等需要提示的事件 → 按设置页下发的配置过滤 → 入队 →
// 通过 tt/poll 长轮询推送给 Client（页面里的动态 client 模块）。
// 事件来源与 dsh-session-notify 一致，作用域为当前会话及其子代理。
//
// 作为动态插件使用时，请粘贴构建产物 dynamic/host.body.js（npm run build:dynamic），
// 或直接把本文件 export default 的对象字面量作为 cordis_define 的 code.host 函数体。

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
function i18n() {
  return I18N[config.locale === 'en' ? 'en' : 'zh']
}

return {
  inject: ['timer'],
  apply(ctx) {
    const queue = []
    const waiters = []
    const titleCache = new Map()
    let seq = 0
    let disposed = false
    let activeSession = null // 由 Client 上报的"当前正在关注的会话"
    const MAX_QUEUE = 200
    const MAX_WAITERS = 32
    const WAIT_MS = 15000

    let config = normalizeConfig(DEFAULT_CONFIG)

    /** 入队一条通知（已按配置过滤），并唤醒所有挂起的长轮询等待者。 */
    function notify(category, sessionId, title, body) {
      if (disposed || !config.enabled) return
      const level = config.categories[category]
      if (!level || level === 'off') return
      if (config.onlyOtherSessions && activeSession && sessionId && sessionId === activeSession) return
      const item = {
        seq: ++seq,
        category: category,
        sessionId: sessionId || null,
        title: String(title || '通知').slice(0, 120),
        body: String(body || '').slice(0, 300),
      }
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

    /** 异步取标题后入队（不阻塞事件瀑布 / 监听器本身）。 */
    function enqueueAfterTitle(category, sessionId, makeTitle, makeBody) {
      readTitle(sessionId).then((title) => {
        notify(category, sessionId, makeTitle(title), makeBody(title))
      }).catch(() => { /* ignore */ })
    }

    // ---------- RPC（Client -> Host，方向固定） ----------
    harness.handle('tt/state', () => ({ config: config }))

    harness.handle('tt/config', (args) => {
      config = normalizeConfig(args && args.config)
      return { ok: true, config: config }
    })

    harness.handle('tt/active', (args) => {
      activeSession = args && typeof args.sessionId === 'string' && args.sessionId ? args.sessionId : null
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

    harness.handle('tt/test', () => {
      const t = i18n()
      const item = {
        seq: ++seq,
        category: 'test',
        sessionId: null,
        title: t.testTitle,
        body: t.testBody,
      }
      queue.push(item)
      if (queue.length > MAX_QUEUE) queue.shift()
      while (waiters.length) {
        const w = waiters.shift()
        try { if (w.dispose) w.dispose() } catch (e) { /* ignore */ }
        try { w.resolve({ items: [item], seq: seq }) } catch (e) { /* ignore */ }
      }
      return { ok: true }
    })

    // ---------- 事件源 ----------
    // 任务完成：subagent/end（completed）
    ctx.on('subagent/end', (info) => {
      try {
        const sessionId = info && info.id ? info.id : undefined
        const stop = info && info.stopReason
        if (stop === 'completed') {
          const t = i18n()
          enqueueAfterTitle('task', sessionId, (s) => t.taskDone(s), (s) => t.taskDoneBody(s))
        } else if (stop === 'error') {
          const t = i18n()
          enqueueAfterTitle('error', sessionId, (s) => t.error(s), (s) => t.errorBody(s))
        }
      } catch (e) { console.error(e) }
    })

    // 任务完成：workflow/agent-end（completed / failed）
    ctx.on('workflow/agent-end', (info, agent) => {
      try {
        const childId = agent && agent.childId ? agent.childId : undefined
        const outcome = agent && agent.outcome
        if (outcome === 'completed') {
          const t = i18n()
          enqueueAfterTitle('task', childId, (s) => t.taskDone(s), (s) => t.taskDoneBody(s))
        } else if (outcome === 'failed') {
          const t = i18n()
          enqueueAfterTitle('error', childId, (s) => t.error(s), (s) => t.errorBody(s))
        }
      } catch (e) { console.error(e) }
    })

    // 任务完成：会话自身 running -> idle
    ctx.on('agent/status', (payload) => {
      try {
        if (!payload || payload.status !== 'idle') return
        const sessionId = payload.agent ? payload.agent.id : undefined
        const t = i18n()
        enqueueAfterTitle('task', sessionId, (s) => t.taskDone(s), (s) => t.taskDoneBody(s))
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
          const t = i18n()
          if (status === 'failed') {
            enqueueAfterTitle('error', sessionId, (s) => t.error(s), () => t.errorBody(label))
          } else if (status === 'completed') {
            enqueueAfterTitle('task', sessionId, (s) => t.taskDone(s), () => t.taskDoneBody(label))
          }
        } catch (e) { /* ignore */ }
      }))
    }

    // 会话出错：agent/error
    ctx.on('agent/error', (payload) => {
      try {
        const sessionId = payload && payload.agent ? payload.agent.id : undefined
        const t = i18n()
        enqueueAfterTitle('error', sessionId, (s) => t.error(s), () => t.errorBody(safeMessage(payload && payload.error)))
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
