// src/static/host.js
// dsh-task-toast —— 静态 Host 半体（部署级，安装到 DSH 本地 profile 后常驻）。
//
// 与 src/host.js（动态版）的差异：
//   · 动态版用 harness.handle 提供会话级 RPC；静态版改用 webServer 注册 HTTP 路由，
//     供页面里的静态 client 模块通过 fetch 轮询 / 提交。
//   · 事件监听逻辑完全一致，但注册在 host 组合的根上下文中，
//     事件作用域为全进程：所有会话的任务完成 / 错误都会进入通知管线。
//
// 构建：scripts/build-static.mjs 把本文件发布为 lib/index.js（原样复制）。
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import {
  CATEGORY_KEYS,
  DEFAULT_CONFIG,
  INSTALL_SOURCE,
  REPO,
  VERSION as FALLBACK_VERSION,
  buildUpdateCommand,
  compareVersion,
  normalizeConfig,
} from './config.js'

// 本地版本：优先读真实 package.json（lib/index.js 的上级目录），失败回落常驻常量。
let LOCAL_VERSION = FALLBACK_VERSION
try {
  const require_ = createRequire(import.meta.url)
  const pkg = require_('../package.json')
  if (pkg && typeof pkg.version === 'string' && pkg.version) LOCAL_VERSION = pkg.version
} catch (e) { /* 打包 / 改写 import.meta.url 的情况下回落常量 */ }

const I18N = {
  zh: {
    taskDone: (s) => (s ? '任务完成 · ' + s : '任务完成'),
    taskDoneBody: (s) => (s ? '会话「' + s + '」的任务已完成' : '会话任务已完成'),
    error: (s) => (s ? '任务出错 · ' + s : '任务出错'),
    errorBody: (s) => (s ? '会话「' + s + '」执行出错' : '会话执行出错'),
    testTitle: '测试通知',
    testBody: '这是一条来自任务提示插件的测试消息，用于验证通知链路。',
    updateTitle: (v) => '插件有新版本 ' + v,
    updateBody: (v, c) => '当前 ' + c + ' · 最新 ' + v + '。点击「更新」复制更新命令，或在设置页一键更新（完成后需重启 dsh）。',
  },
  en: {
    taskDone: (s) => (s ? 'Task completed · ' + s : 'Task completed'),
    taskDoneBody: (s) => (s ? 'Task in “' + s + '” finished' : 'Session task finished'),
    error: (s) => (s ? 'Task failed · ' + s : 'Task failed'),
    errorBody: (s) => (s ? 'Task in “' + s + '” failed' : 'Session task failed'),
    testTitle: 'Test notification',
    testBody: 'This is a test message from the task-toast plugin, used to verify the pipeline.',
    updateTitle: (v) => 'Plugin update available: ' + v,
    updateBody: (v, c) => 'Installed ' + c + ' · latest ' + v + '. Click “Update” to copy the command, or use one-click update in Settings (restart dsh afterwards).',
  },
}
function i18n(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : DEFAULT_CONFIG
  return I18N[c.locale === 'en' ? 'en' : 'zh']
}

export default {
  name: 'dsh-task-toast',
  inject: ['timer', 'webServer'],
  apply(ctx) {
    console.log('[dsh-task-toast] host apply() 开始执行（dsh-task-toast 宿主插件已加载）')
    const queue = []
    const waiters = []
    const titleCache = new Map()
    let seq = 0
    let disposed = false
    let activeSession = null // 页面上报的"当前正在关注的会话"
    const MAX_QUEUE = 200
    const MAX_WAITERS = 64
    const WAIT_MS = 15000

    let config = normalizeConfig(DEFAULT_CONFIG)

    // ---------- 更新检查状态 ----------
    const updateState = {
      local: LOCAL_VERSION,
      latest: null,        // 上游最新版本号（string | null）
      hasUpdate: false,
      url: null,           // 发布页
      notes: '',
      checkedAt: 0,        // 时间戳（ms）
      checking: false,
      error: null,
    }
    const updateCmd = buildUpdateCommand()

    /** 拉取上游最新版本：优先 releases/latest，失败回落 tags 列表。 */
    async function fetchLatest() {
      const ctrl = new AbortController()
      const to = setTimeout(() => { try { ctrl.abort() } catch (e) { /* ignore */ } }, 8000)
      const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-task-toast' }
      try {
        let res = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: headers, signal: ctrl.signal })
        if (res.ok) {
          const j = await res.json()
          const tag = j && (j.tag_name || j.name)
          if (tag) {
            return {
              version: String(tag).replace(/^v/i, ''),
              url: (j && j.html_url) || null,
              notes: (j && typeof j.body === 'string' ? j.body : '').slice(0, 600),
            }
          }
        }
        res = await fetch('https://api.github.com/repos/' + REPO + '/tags', { headers: headers, signal: ctrl.signal })
        if (res.ok) {
          const arr = await res.json()
          if (Array.isArray(arr) && arr.length && arr[0] && arr[0].name) {
            return {
              version: String(arr[0].name).replace(/^v/i, ''),
              url: 'https://github.com/' + REPO + '/releases',
              notes: '',
            }
          }
        }
        throw new Error('no release info')
      } finally {
        clearTimeout(to)
      }
    }

    /** 执行一次更新检查。silent = true 时不弹通知（例如用户手动点「立即检查」后再由前端展示）。 */
    async function checkUpdate(silent) {
      if (disposed || updateState.checking) return updateState
      updateState.checking = true
      updateState.error = null
      try {
        const info = await fetchLatest()
        updateState.latest = info.version
        updateState.url = info.url
        updateState.notes = info.notes
        updateState.checkedAt = Date.now()
        updateState.hasUpdate = compareVersion(info.version, updateState.local) > 0
        if (updateState.hasUpdate && !silent) {
          const t = i18n(config)
          notify('update', null, t.updateTitle(info.version), t.updateBody(info.version, updateState.local))
        }
        console.log('[dsh-task-toast] 更新检查完成：本地 ' + updateState.local + ' / 上游 ' + info.version + (updateState.hasUpdate ? '（有新版本）' : '（已是最新）'))
      } catch (e) {
        updateState.error = (e && e.message) ? e.message : String(e)
        updateState.checkedAt = Date.now()
        console.warn('[dsh-task-toast] 更新检查失败（忽略）：', updateState.error)
      } finally {
        updateState.checking = false
      }
      return updateState
    }

    /** 周期调度：启动后延迟 8s 首检，之后按 config.updateIntervalHours 间隔重复。 */
    let updateTimerHandle = null
    function scheduleUpdateCheck(delayMs) {
      if (!ctx.timer || typeof ctx.timer.timeout !== 'function') return
      try {
        updateTimerHandle = ctx.timer.timeout(() => {
          updateTimerHandle = null
          if (disposed) return
          if (config.checkUpdate) checkUpdate(false).catch(() => { /* ignore */ })
          scheduleUpdateCheck(Math.max(1, config.updateIntervalHours || 6) * 3600 * 1000)
        }, delayMs)
      } catch (e) { /* ignore */ }
    }

    /** 执行一条 shell 命令，返回 { code, out, err }（带 3 分钟超时，防止安装卡死）。 */
    function runShell(command) {
      return new Promise((resolve) => {
        try {
          const child = spawn(command, { shell: true, windowsHide: true })
          let out = ''
          let err = ''
          let done = false
          const to = setTimeout(() => {
            if (done) return
            try { child.kill('SIGKILL') } catch (e) { /* ignore */ }
          }, 180000)
          const finish = (code) => {
            if (done) return
            done = true
            clearTimeout(to)
            resolve({ code: code, out: out.slice(-4000), err: err.slice(-4000) })
          }
          child.stdout.on('data', (d) => { out += String(d) })
          child.stderr.on('data', (d) => { err += String(d) })
          child.on('error', (e) => { err += String((e && e.message) || e); finish(-1) })
          child.on('close', (code) => { finish(typeof code === 'number' ? code : -1) })
        } catch (e) {
          resolve({ code: -1, out: '', err: String((e && e.message) || e) })
        }
      })
    }

    /** 一键更新：remove → add，返回合并日志。 */
    async function performUpdate() {
      const steps = []
      const remove = await runShell('dsh plugin --profile web remove dsh-task-toast')
      steps.push('$ dsh plugin --profile web remove dsh-task-toast\n' + (remove.out || '') + (remove.err || ''))
      const add = await runShell('dsh plugin --profile web add ' + INSTALL_SOURCE)
      steps.push('$ dsh plugin --profile web add ' + INSTALL_SOURCE + '\n' + (add.out || '') + (add.err || ''))
      const ok = remove.code === 0 && add.code === 0
      return { ok: ok, log: steps.join('\n\n'), removeCode: remove.code, addCode: add.code }
    }

    // ---------- HTTP 辅助 ----------
    function sendJson(res, code, obj) {
      try {
        const body = JSON.stringify(obj)
        res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
        res.end(body)
      } catch (e) { /* ignore */ }
    }
    function readJson(req) {
      return new Promise((resolve) => {
        let data = ''
        req.on('data', (c) => {
          data += c
          if (data.length > 65536) { req.destroy(); resolve(null) }
        })
        req.on('end', () => { try { resolve(JSON.parse(data || '{}')) } catch (e) { resolve(null) } })
        req.on('error', () => resolve(null))
      })
    }

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

    function enqueueAfterTitle(category, sessionId, makeTitle, makeBody) {
      readTitle(sessionId).then((title) => {
        notify(category, sessionId, makeTitle(title), makeBody(title))
      }).catch(() => { /* ignore */ })
    }

    // ---------- HTTP 路由（页面静态 client 的访问面） ----------
    // 关键诊断：webServer 服务不可用时，host 无法响应 client 的 fetch，
    // 表现为「设置页能看到、但测试通知与真实通知都不弹」。这里显式报错并跳过注册。
    if (!ctx.webServer || typeof ctx.webServer.register !== 'function') {
      console.error('[dsh-task-toast] FATAL: ctx.webServer 不可用 —— 无法注册 HTTP 路由，client 长轮询将全部失败（测试通知/任务通知不会弹出）。请确认 dsh 版本是否提供 webServer 服务。')
    } else {
      const safeRegister = (label, spec) => {
        try {
          ctx.webServer.register(spec)
        } catch (e) {
          console.error('[dsh-task-toast] 注册路由失败 ' + label + ':', e && e.message ? e.message : e)
        }
      }

      safeRegister('/state', {
        kind: 'exact',
        path: '/dsh-task-toast/state',
        handler: (req, res) => {
          if (req.method !== 'GET') { sendJson(res, 405, { ok: false }); return }
          sendJson(res, 200, { config: config })
        },
      })

      safeRegister('/config', {
        kind: 'exact',
        path: '/dsh-task-toast/config',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          const body = await readJson(req)
          config = normalizeConfig(body && body.config)
          sendJson(res, 200, { ok: true, config: config })
        },
      })

      safeRegister('/active', {
        kind: 'exact',
        path: '/dsh-task-toast/active',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          const body = await readJson(req)
          activeSession = body && typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : null
          sendJson(res, 200, { ok: true, activeSession: activeSession })
        },
      })

      safeRegister('/test', {
        kind: 'exact',
        path: '/dsh-task-toast/test',
        handler: (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          const t = i18n(config)
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
          sendJson(res, 200, { ok: true })
        },
      })

      safeRegister('/poll', {
        kind: 'exact',
        path: '/dsh-task-toast/poll',
        handler: (req, res) => {
          if (req.method !== 'GET') { sendJson(res, 405, { ok: false }); return }
          let since = 0
          try {
            const url = new URL(req.url, 'http://localhost')
            since = Number(url.searchParams.get('since')) || 0
          } catch (e) { /* ignore */ }
          const pending = queue.filter((i) => i.seq > since)
          if (pending.length) {
            sendJson(res, 200, { items: pending, seq: seq })
            return
          }
          if (waiters.length >= MAX_WAITERS || disposed) {
            sendJson(res, 200, { items: [], seq: seq })
            return
          }
          const w = { settled: false, res: res, dispose: null, resolve: null }
          w.resolve = (value) => {
            if (w.settled) return
            w.settled = true
            const idx = waiters.indexOf(w)
            if (idx >= 0) waiters.splice(idx, 1)
            try { if (w.dispose) w.dispose() } catch (e) { /* ignore */ }
            sendJson(w.res, 200, value)
          }
          w.dispose = ctx.timer.timeout(() => {
            w.resolve({ items: [], seq: seq })
          }, WAIT_MS)
          req.on('close', () => {
            w.resolve({ items: [], seq: seq })
          })
          waiters.push(w)
        },
      })

      safeRegister('/version', {
        kind: 'exact',
        path: '/dsh-task-toast/version',
        handler: (req, res) => {
          if (req.method !== 'GET') { sendJson(res, 405, { ok: false }); return }
          sendJson(res, 200, Object.assign({ ok: true, updateCmd: updateCmd, repo: REPO }, updateState))
        },
      })

      safeRegister('/check-update', {
        kind: 'exact',
        path: '/dsh-task-toast/check-update',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          const st = await checkUpdate(true)
          sendJson(res, 200, Object.assign({ ok: true, updateCmd: updateCmd, repo: REPO }, st))
        },
      })

      safeRegister('/update', {
        kind: 'exact',
        path: '/dsh-task-toast/update',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          console.log('[dsh-task-toast] 收到一键更新请求，开始执行 remove → add …')
          const result = await performUpdate()
          console.log('[dsh-task-toast] 一键更新结束：ok=' + result.ok)
          sendJson(res, 200, Object.assign({ ok: result.ok }, result))
        },
      })

      console.log('[dsh-task-toast] host 已挂载：8 条 HTTP 路由（/dsh-task-toast/{state,config,active,test,poll,version,check-update,update}）注册完成。')
    }

    // ---------- 启动更新检查调度（延迟 8s 首检，避免拖慢 dsh 启动） ----------
    if (config.checkUpdate) {
      scheduleUpdateCheck(8000)
      console.log('[dsh-task-toast] 更新检查已排程：8s 后首检，之后每 ' + config.updateIntervalHours + ' 小时一次。')
    } else {
      console.log('[dsh-task-toast] 更新检查已关闭（可在设置页开启）。')
    }

    // ---------- 事件源（与动态版一致；根上下文 = 全进程作用域） ----------
    ctx.on('subagent/end', (info) => {
      try {
        const sessionId = info && info.id ? info.id : undefined
        const stop = info && info.stopReason
        if (stop === 'completed') {
          const t = i18n(config)
          enqueueAfterTitle('task', sessionId, (s) => t.taskDone(s), (s) => t.taskDoneBody(s))
        } else if (stop === 'error') {
          const t = i18n(config)
          enqueueAfterTitle('error', sessionId, (s) => t.error(s), (s) => t.errorBody(s))
        }
      } catch (e) { console.error(e) }
    })

    ctx.on('workflow/agent-end', (info, agent) => {
      try {
        const childId = agent && agent.childId ? agent.childId : undefined
        const outcome = agent && agent.outcome
        if (outcome === 'completed') {
          const t = i18n(config)
          enqueueAfterTitle('task', childId, (s) => t.taskDone(s), (s) => t.taskDoneBody(s))
        } else if (outcome === 'failed') {
          const t = i18n(config)
          enqueueAfterTitle('error', childId, (s) => t.error(s), (s) => t.errorBody(s))
        }
      } catch (e) { console.error(e) }
    })

    ctx.on('agent/status', (payload) => {
      try {
        if (!payload || payload.status !== 'idle') return
        const sessionId = payload.agent ? payload.agent.id : undefined
        const t = i18n(config)
        enqueueAfterTitle('task', sessionId, (s) => t.taskDone(s), (s) => t.taskDoneBody(s))
      } catch (e) { console.error(e) }
    })

    const jobs = ctx.get('jobs')
    if (jobs && typeof jobs.onJobDone === 'function') {
      ctx.effect(() => jobs.onJobDone((snapshot, owner) => {
        try {
          const sessionId = (snapshot && snapshot.ownerSession) || (owner && owner.id) || undefined
          const label = snapshot && typeof snapshot.label === 'string' ? snapshot.label : '后台任务'
          const status = snapshot && snapshot.status
          const t = i18n(config)
          if (status === 'failed') {
            enqueueAfterTitle('error', sessionId, (s) => t.error(s), () => t.errorBody(label))
          } else if (status === 'completed') {
            enqueueAfterTitle('task', sessionId, (s) => t.taskDone(s), () => t.taskDoneBody(label))
          }
        } catch (e) { /* ignore */ }
      }))
    }

    ctx.on('agent/error', (payload) => {
      try {
        const sessionId = payload && payload.agent ? payload.agent.id : undefined
        const t = i18n(config)
        enqueueAfterTitle('error', sessionId, (s) => t.error(s), () => t.errorBody(safeMessage(payload && payload.error)))
      } catch (e) { console.error(e) }
    })

    // 停止 / 更新时：结束所有挂起的长轮询，防止悬空响应
    ctx.effect(() => {
      return () => {
        disposed = true
        if (updateTimerHandle) {
          try { if (typeof updateTimerHandle === 'function') updateTimerHandle(); else clearTimeout(updateTimerHandle) } catch (e) { /* ignore */ }
          updateTimerHandle = null
        }
        while (waiters.length) {
          const w = waiters.shift()
          try { if (w.dispose) w.dispose() } catch (e) { /* ignore */ }
          try { w.resolve({ items: [], seq: seq }) } catch (e) { /* ignore */ }
        }
      }
    })
  },
}
