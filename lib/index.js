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
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activateDesktopWindow, isDesktopActivationRequest, isCardActionRequest } from './desktop-activation.js'
import {
  CATEGORY_KEYS,
  DEFAULT_CONFIG,
  REPO,
  VERSION as FALLBACK_VERSION,
  normalizeConfig,
} from './config.js'

// 置顶脚本位置：lib/index.js → 插件根 → scripts/topmost.ps1
let TOPMOST_SCRIPT = ''
try {
  TOPMOST_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'topmost.ps1')
} catch (e) { /* 无法解析时置顶功能自动跳过 */ }

// 独立卡片脚本位置：scripts/card.ps1（Windows：WinForms 无边框置顶浮窗）
let CARD_SCRIPT = ''
try {
  CARD_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'card.ps1')
} catch (e) { /* ignore */ }

// macOS 独立卡片脚本：scripts/card-mac.sh（osascript 原生通知，跨应用置顶 + 通知中心留痕）
let CARD_SCRIPT_MAC = ''
try {
  CARD_SCRIPT_MAC = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'card-mac.sh')
} catch (e) { /* ignore */ }

// 从自身安装路径推断 dsh profile：
//   ~/.dsh/profiles/<name>/node_modules/dsh-task-toast/lib/index.js → <name>
// 桌面客户端用 desktop，CLI/网页面板用 web —— 更新命令必须打到正确的 profile，
// 否则会出现「更新成功但当前窗口没变化」。
let DETECTED_PROFILE = ''
try {
  const self = fileURLToPath(import.meta.url).replace(/\\/g, '/')
  const m = self.match(/\/profiles\/([^/]+)\//)
  if (m && m[1]) DETECTED_PROFILE = m[1]
} catch (e) { /* ignore */ }

// 本地版本：以 lib/config.js 里的 VERSION 为准（它会随自更新一起被替换），
// package.json 仅在常量缺失时兜底 —— 否则自更新后会永远显示旧版本号。
let LOCAL_VERSION = FALLBACK_VERSION
if (!LOCAL_VERSION) {
  try {
    const require_ = createRequire(import.meta.url)
    const pkg = require_('../package.json')
    if (pkg && typeof pkg.version === 'string' && pkg.version) LOCAL_VERSION = pkg.version
  } catch (e) { /* ignore */ }
}

const I18N = {
  zh: {
    taskDone: (s) => (s ? '任务完成 · ' + s : '任务完成'),
    taskDoneBody: (s) => (s ? '会话「' + s + '」的任务已完成' : '会话任务已完成'),
    error: (s) => (s ? '任务出错 · ' + s : '任务出错'),
    errorBody: (s) => (s ? '会话「' + s + '」执行出错' : '会话执行出错'),
    testTitle: '测试通知',
    testBody: '这是一条来自任务提示插件的测试消息，用于验证通知链路。',
    cardProbeBody: '如果你看到这张卡片浮在所有窗口之上，说明独立卡片工作正常。点任意按钮即可关闭。',
    viewResult: '查看结果',
    later: '稍后',
    dismiss: '忽略',
    updateTitle: () => '插件更新',
    updateBody: () => '请在 dshmarket 的已安装页面管理更新。',
  },
  en: {
    taskDone: (s) => (s ? 'Task completed · ' + s : 'Task completed'),
    taskDoneBody: (s) => (s ? 'Task in “' + s + '” finished' : 'Session task finished'),
    error: (s) => (s ? 'Task failed · ' + s : 'Task failed'),
    errorBody: (s) => (s ? 'Task in “' + s + '” failed' : 'Session task failed'),
    testTitle: 'Test notification',
    testBody: 'This is a test message from the task-toast plugin, used to verify the pipeline.',
    cardProbeBody: 'If this card floats above every window, the standalone card works. Click any button to close it.',
    viewResult: 'View result',
    later: 'Later',
    dismiss: 'Dismiss',
    updateTitle: () => 'Plugin updates',
    updateBody: () => 'Manage updates on the Installed page in dshmarket.',
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
    const runtimeKey = Symbol.for('dsh-task-toast.runtime-state.v1')
    const owner = ctx.root || ctx
    let runtime = owner[runtimeKey]
    if (!runtime || runtime.schema !== 1) {
      runtime = { schema: 1, config: normalizeConfig(DEFAULT_CONFIG), queue: [], seq: 0, streamId: Date.now().toString(36) + Math.random().toString(36).slice(2) }
      owner[runtimeKey] = runtime
    }
    runtime.pending = runtime.pending || []
    const queue = runtime.queue
    const waiters = []
    const titleCache = new Map()
    let seq = runtime.seq
    let disposed = false
    const activeClients = new Map() // clientId -> { sessionId, foreground, at }
    let legacyActiveSession = null // session-only clients keep the old same-session behavior
    const ACTIVE_CLIENT_TTL_MS = 30000
    const streamingSessions = new Set()
    const MAX_QUEUE = 200
    const MAX_WAITERS = 64
    const WAIT_MS = 15000
    // 突发合并：同一会话 / 同分类在窗口内的连续通知合并为一条（显示 ×N 计数），避免子代理并发刷屏
    const GROUP_WINDOW_MS = 60 * 1000
    const groupBuf = new Map()

    let config = normalizeConfig(runtime.config)

    // Distribution and update execution belong to dshmarket / the Host.
    function resolveProfile() {
      return process.env.DSH_PROFILE || DETECTED_PROFILE || 'web'
    }

    // ---------- 置顶：把 dsh 客户端窗口抬到「所有应用之上」 ----------
    let topmostActive = false
    let topmostTimer = null

    function topmostSupported() {
      return process.platform === 'win32' && !!TOPMOST_SCRIPT
    }

    /**
     * 调用 scripts/topmost.ps1 执行置顶 / 恢复。
     * ProcessId 用 process.ppid（Electron 主进程），找不到窗口时脚本会按标题兜底匹配。
     */
    function runTopmost(action, durationMs) {
      return new Promise((resolve) => {
        if (!topmostSupported()) { resolve({ ok: false, error: 'unsupported-platform' }); return }
        const cfg = config.topmost || {}
        const args = [
          '-NoProfile', '-ExecutionPolicy', 'Bypass',
          '-File', TOPMOST_SCRIPT,
          '-ProcessId', String(process.ppid || 0),
          '-Action', action,
          '-TitleContains', String(cfg.matchTitle || ''),
        ]
        if (typeof durationMs === 'number' && durationMs > 0) args.push('-Duration', String(durationMs))
        try {
          const child = spawn('powershell', args, { windowsHide: true })
          let out = ''
          let done = false
          let timer = null
          const finish = (r) => {
            if (done) return
            done = true
            if (timer) clearTimeout(timer)
            resolve(r)
          }
          timer = setTimeout(() => {
            try { child.kill('SIGKILL') } catch (e) { /* ignore */ }
            finish({ ok: false, error: 'timeout' })
          }, 15000)
          child.stdout.on('data', (d) => { out += String(d) })
          child.stderr.on('data', () => { /* ignore */ })
          child.on('error', (e) => finish({ ok: false, error: String((e && e.message) || e) }))
          child.on('close', () => {
            try {
              const line = out.trim().split(/\r?\n/).filter(Boolean).pop() || ''
              finish(JSON.parse(line))
            } catch (e) {
              finish({ ok: false, error: 'bad-output', raw: out.slice(-200) })
            }
          })
        } catch (e) {
          resolve({ ok: false, error: String((e && e.message) || e) })
        }
      })
    }

    /** 通知出现时：抬到最上层，并在时长结束后自动恢复。 */
    function holdTopmost() {
      const cfg = config.topmost || {}
      if (!cfg.enabled || !topmostSupported() || disposed) return
      const dur = cfg.durationMs > 0 ? cfg.durationMs : (config.autoDismissMs || 10000) + 1500
      if (!topmostActive) {
        topmostActive = true
        runTopmost('topmost').then((r) => {
          if (!r || !r.ok) {
            topmostActive = false
            console.warn('[dsh-task-toast] 置顶未生效（多为非桌面客户端或窗口未找到）：' + JSON.stringify(r))
          } else {
            console.log('[dsh-task-toast] 已置顶 dsh 窗口 ' + JSON.stringify((r.handles || []).map(String)) + '，' + dur + 'ms 后恢复')
          }
        }).catch(() => { topmostActive = false })
      }
      if (topmostTimer) {
        try { if (typeof topmostTimer === 'function') topmostTimer(); else clearTimeout(topmostTimer) } catch (e) { /* ignore */ }
      }
      if (ctx.timer && typeof ctx.timer.timeout === 'function') {
        topmostTimer = ctx.timer.timeout(() => { topmostTimer = null; releaseTopmost() }, dur)
      }
    }

    /** 立即恢复窗口层级（用户在浮层上点了按钮时提前调用）。 */
    function releaseTopmost() {
      if (!topmostActive) return
      topmostActive = false
      if (topmostTimer) {
        try { if (typeof topmostTimer === 'function') topmostTimer(); else clearTimeout(topmostTimer) } catch (e) { /* ignore */ }
        topmostTimer = null
      }
      runTopmost('restore').catch(() => { /* ignore */ })
    }

    // ---------- 独立置顶小卡片（scripts/card.ps1） ----------
    // 与 topmost 的区别：不抬 dsh 大窗口，而是起一个独立的无边框浮窗，
    // 只占屏幕一角、真·TopMost、不抢焦点，按钮点击后 POST 回 /card-action。
    const cardChildren = new Map()   // slot -> child
    const cardItems = new Map()      // id(seq) -> item（供 /card-action 回调查详情）
    let cardSeq = 0
    let latestCardView = 0
    let selfPort = 0                 // 从任意一条入站请求的 Host 头里学到的监听端口
    // 最近一次卡片结果（/version 暴露给设置页：卡片没弹出来时能直接看到原因）
    let lastCard = { at: 0, ok: false, error: '尚未弹出过卡片' }

    // 等待独立卡片完成首次编译和显示。
    const CARD_WATCHDOG_MS = 20000

    /** 卡片追踪日志路径（card.ps1 每阶段都会写），用于事后排障。 */
    function cardLogPath() {
      const base = process.env.LOCALAPPDATA || process.env.APPDATA
        || join(homedir(), 'AppData', 'Local')
        || join(homedir(), 'AppData', 'Roaming')
      try { return join(base, 'dsh-task-toast', 'card.log') } catch (e) { return '' }
    }
    function readCardLog(maxChars) {
      const p = cardLogPath()
      if (!p) return ''
      try {
        if (!existsSync(p)) return ''
        const t = readFileSync(p, 'utf8')
        return t.length > maxChars ? t.slice(-maxChars) : t
      } catch (e) { return '' }
    }

    // ---------- 通知历史（持久化，供「通知中心」回看；与内存队列独立，插件重启不丢） ----------
    function historyPath() {
      const base = process.env.LOCALAPPDATA || process.env.APPDATA
        || join(homedir(), 'AppData', 'Local')
        || join(homedir(), 'dsh-task-toast')
      try { return join(base, 'dsh-task-toast', 'notify-history.json') } catch (e) { return '' }
    }
    function loadHistory() {
      const p = historyPath()
      if (!p) return []
      try {
        if (!existsSync(p)) return []
        const arr = JSON.parse(readFileSync(p, 'utf8'))
        return Array.isArray(arr) ? arr : []
      } catch (e) { return [] }
    }
    function recordHistory(item) {
      try {
        const p = historyPath()
        if (!p) return
        const list = loadHistory()
        list.unshift({ seq: item.seq, category: item.category, sessionId: item.sessionId, title: item.title, body: item.body, ts: Date.now() })
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(p, JSON.stringify(list.slice(0, 200)))
      } catch (e) { /* 历史写入失败绝不影响通知主链路 */ }
    }
    function clearHistory() {
      try { const p = historyPath(); if (p) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, '[]') } } catch (e) { /* ignore */ }
    }

    function pruneActiveClients(now) {
      for (const [clientId, focus] of activeClients) {
        if (now - focus.at >= ACTIVE_CLIENT_TTL_MS) activeClients.delete(clientId)
      }
    }

    function updateActiveClient(body) {
      const payload = body && typeof body === 'object' ? body : {}
      const clientId = typeof payload.clientId === 'string' && payload.clientId && payload.clientId.length <= 128
        ? payload.clientId
        : null
      const sessionId = typeof payload.sessionId === 'string' && payload.sessionId ? payload.sessionId : null
      const foreground = typeof payload.foreground === 'boolean' ? payload.foreground : true
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

    function cardSupported() {
      if (process.platform === 'win32') {
        if (!CARD_SCRIPT) return false
        try { return existsSync(CARD_SCRIPT) } catch (e) { return false }
      }
      if (process.platform === 'darwin') {
        if (!CARD_SCRIPT_MAC) return false
        try { return existsSync(CARD_SCRIPT_MAC) } catch (e) { return false }
      }
      return false
    }

    /** 当前平台的独立卡片脚本路径（win32 → card.ps1，darwin → card-mac.sh）。 */
    function cardScriptForPlatform() {
      if (process.platform === 'win32') return CARD_SCRIPT
      if (process.platform === 'darwin') return CARD_SCRIPT_MAC
      return ''
    }

    /** 取一个空闲槽位，让多张卡片竖向堆叠而不是叠在一起。 */
    function allocSlot() {
      for (let i = 0; i < 8; i += 1) {
        if (!cardChildren.has(i)) return i
      }
      return cardChildren.size
    }

    function cardTimeoutMs() {
      const c = config.topmost || {}
      const base = c.durationMs > 0 ? c.durationMs : (config.autoDismissMs || 10000)
      return Math.max(3000, Math.min(120000, base))
    }

    /**
     * 启动独立卡片进程，并等待它回报「窗口已显示」。
     * 返回 Promise<{ ok, error, stderr }>：
     *   · 卡片确认显示 → { ok: true }
     *   · 进程异常退出 / 5 秒内未显示 → { ok: false, error, stderr }
     * 调用方在失败时必须把通知转回应用内呈现 —— 通知永远不能因为卡片挂了而丢掉。
     */
    /** 卡片启动参数（card.ps1） */
    function cardArgs(item, slot) {
      const id = String(item.seq)
      const t = i18n(config)
      const args = [
        '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass',
        '-File', CARD_SCRIPT,
        '-Title', String(item.title || '').replace(/[\r\n]+/g, ' ').slice(0, 120),
        '-Body', String(item.body || '').replace(/[\r\n]+/g, ' ').slice(0, 300),
        '-SessionId', String(item.sessionId || ''),
        '-Locale', config.locale === 'en' ? 'en' : 'zh',
        '-Position', String(config.position || 'bottom-right'),
        '-Theme', String(config.theme || 'auto'),
        '-Accent', config.accent || '#007AFF',
        '-Timeout', String(cardTimeoutMs()),
        '-Slot', String(slot),
        '-Id', id,
        // Localized button labels stay out of the PowerShell and embedded C# source.
        '-BtnView', t.viewResult,
        '-BtnLater', t.later,
        '-BtnIgnore', t.dismiss,
      ]
      if (selfPort) args.push('-CallbackUrl', 'http://127.0.0.1:' + selfPort + '/dsh-task-toast/card-action')
      return args
    }

    /**
     * 按当前平台拼出「独立卡片」启动命令：
     *   · win32  → powershell card.ps1 <flags>
     *   · darwin → bash card-mac.sh <flags>（原生通知，跨应用置顶 + 通知中心）
     * 返回 null 表示当前平台不支持（调用方应回退应用内呈现）。
     */
    /** macOS 独立卡片启动参数：card-mac.sh 只认这些 flag（会忽略 -NoProfile/-File 等 PowerShell 专属项）。 */
    function cardMacArgs(item) {
      const id = String(item.seq)
      const t = i18n(config)
      return [
        '-Title', String(item.title || '').replace(/[\r\n]+/g, ' ').slice(0, 120),
        '-Body', String(item.body || '').replace(/[\r\n]+/g, ' ').slice(0, 300),
        '-Locale', config.locale === 'en' ? 'en' : 'zh',
        '-Position', String(config.position || 'bottom-right'),
        '-Theme', String(config.theme || 'auto'),
        '-Accent', config.accent || '#007AFF',
        '-Timeout', String(cardTimeoutMs()),
        '-Slot', '0',
        '-Id', id,
        '-BtnView', t.viewResult,
        '-BtnLater', t.later,
        '-BtnIgnore', t.dismiss,
      ]
    }

    function cardSpawnArgs(item, slot) {
      const flags = cardArgs(item, slot)
      if (process.platform === 'win32') return { cmd: 'powershell', args: flags }
      if (process.platform === 'darwin') {
        const sc = cardScriptForPlatform()
        if (!sc) return null
        // 不再复用 PowerShell 的 flags（-NoProfile/-File 等会被 shell 解析器当作未知单参吃掉），
        // 改用 card-mac.sh 专属的干净 flag 列表。
        return { cmd: 'bash', args: [sc].concat(cardMacArgs(item)) }
      }
      return null
    }


    function spawnCard(item) {
      return new Promise((resolve) => {
        if (!cardSupported() || disposed) { resolve({ ok: false, error: 'card script unavailable' }); return }
        const slot = allocSlot()
        const id = String(item.seq)
        cardItems.set(id, item)
        if (cardItems.size > 40) {
          const oldest = cardItems.keys().next().value
          if (oldest !== undefined) cardItems.delete(oldest)
        }
        cardSeq += 1

        const sp = cardSpawnArgs(item, slot)
        if (!sp) { cardItems.delete(id); resolve({ ok: false, error: 'card spawn args unavailable' }); return }

        let child
        try {
          child = spawn(sp.cmd, sp.args, { windowsHide: true })
        } catch (e) {
          cardItems.delete(id)
          resolve({ ok: false, error: 'spawn: ' + ((e && e.message) || e), stderr: '' })
          return
        }

        const startedAt = Date.now()
        let settled = false
        let stderrBuf = ''
        let outBuf = ''
        let stage = 'boot'
        let watchdog = null
        const release = () => {
          if (cardChildren.get(slot) === child) cardChildren.delete(slot)
        }
        cardChildren.set(slot, child)

        const settle = (ok, error) => {
          if (settled) return
          settled = true
          if (watchdog) { try { clearTimeout(watchdog) } catch (e) { /* ignore */ } }
          lastCard = {
            at: Date.now(),
            ok: ok,
            error: ok ? '' : String(error || 'unknown'),
            stage: stage,
            ms: Date.now() - startedAt,
          }
          if (!ok) {
            console.warn('[dsh-task-toast] 独立卡片未显示（阶段=' + stage + '，' + error + '），通知转回应用内呈现')
            if (stderrBuf) console.warn('[dsh-task-toast] 卡片 stderr：' + stderrBuf.slice(-600))
            cardItems.delete(id)
            try { child.kill() } catch (e) { /* ignore */ }
          } else {
            console.log('[dsh-task-toast] 独立卡片已显示 #' + cardSeq + '（slot ' + slot + '，' + cardTimeoutMs() + 'ms 后自动消失）')
          }
          resolve({ ok: ok, error: ok ? '' : String(error || 'unknown'), stage: stage, stderr: stderrBuf.slice(-300) })
        }

        // 20 秒内没等到「窗口已显示」才判定失败。
        // 冷启动时 PowerShell 需要即时编译 C#，实测可到 4~5 秒；5 秒会误杀。
        watchdog = setTimeout(() => {
          settle(false, 'timeout: 卡片 ' + (CARD_WATCHDOG_MS / 1000) + ' 秒内未报告窗口已显示（最后阶段=' + stage + '）')
        }, CARD_WATCHDOG_MS)

        try {
          if (child.stderr) child.stderr.on('data', (d) => { stderrBuf += String(d); if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-2000) })
          if (child.stdout) child.stdout.on('data', (d) => {
            outBuf += String(d)
            // 逐行解析阶段打点 {"stage":"xxx","ms":n}
            try {
              const lines = String(d).split(/\r?\n/)
              for (const ln of lines) {
                const m = ln.match(/"stage"\s*:\s*"([^"]+)"/)
                if (m && m[1]) stage = m[1]
              }
            } catch (e) { /* ignore */ }
            if (outBuf.indexOf('"stage":"shown"') >= 0) { release(); settle(true, '') }
          })
        } catch (e) { /* ignore */ }

        child.on('error', (e) => settle(false, 'spawn error: ' + ((e && e.message) || e)))
        child.on('close', (code) => {
          release()
          if (!settled) {
            const tail = stderrBuf ? ' · ' + stderrBuf.slice(-160).replace(/\s+/g, ' ') : ''
            settle(false, '进程提前退出 code=' + code + '（阶段=' + stage + '，耗时 ' + (Date.now() - startedAt) + 'ms）' + tail)
          }
        })
      })
    }

    /** 关闭全部卡片（停止插件 / 关闭功能时调用，避免残留窗口）。 */
    function closeAllCards() {
      for (const child of Array.from(cardChildren.values())) {
        try { child.kill() } catch (e) { /* ignore */ }
      }
      cardChildren.clear()
      cardItems.clear()
    }

    function topmostMode() {
      const c = config.topmost || {}
      return c.mode === 'card' || c.mode === 'window' || c.mode === 'off' ? c.mode : 'off'
    }

    // ---------- 卡片自检：启动后跑一次 `-SelfTest 1`（不创建窗口） ----------
    // 目的是把「卡片能不能用」提前暴露到日志里，而不是等真实通知才发现。
    let cardSelfTest = 'pending'
    function runCardSelfTest() {
      if (!cardSupported()) { cardSelfTest = 'unsupported'; return }
      let child
      try {
        if (process.platform === 'darwin') {
          child = spawn('bash', [cardScriptForPlatform(), '-SelfTest', '1'], { windowsHide: true })
        } else {
          child = spawn('powershell', [
            '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass',
            '-File', CARD_SCRIPT, '-SelfTest', '1',
          ], { windowsHide: true })
        }
      } catch (e) {
        cardSelfTest = 'spawn error: ' + ((e && e.message) || e)
        console.warn('[dsh-task-toast] 卡片自检无法启动：' + cardSelfTest)
        return
      }
      let out = ''
      let err = ''
      const to = setTimeout(() => { try { child.kill() } catch (e) { /* ignore */ } }, 25000)
      if (child.stdout) child.stdout.on('data', (d) => { out += String(d) })
      if (child.stderr) child.stderr.on('data', (d) => { err += String(d) })
      child.on('error', (e) => {
        clearTimeout(to)
        cardSelfTest = 'spawn error: ' + ((e && e.message) || e)
        console.warn('[dsh-task-toast] 卡片自检失败（将回退到提升窗口）：' + cardSelfTest)
      })
      child.on('close', (code) => {
        clearTimeout(to)
        if (code === 0 && out.indexOf('"ok":true') >= 0) {
          cardSelfTest = 'ok'
          console.log('[dsh-task-toast] 卡片自检通过：独立卡片可用（亚克力模糊 + 圆角 + 置顶）')
        } else {
          cardSelfTest = 'fail: ' + (err || out || ('exit ' + code)).replace(/\s+/g, ' ').slice(0, 400)
          console.warn('[dsh-task-toast] 卡片自检失败（真实通知时会自动回退到提升窗口）：' + cardSelfTest)
        }
      })
    }


    function sendJson(res, code, obj) {
      try {
        const body = JSON.stringify(Array.isArray(obj.items) ? { ...obj, streamId: runtime.streamId } : obj)
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

    /**
     * 从入站请求的 Host 头里学出本服务监听端口 —— 卡片要用它回调 /card-action。
     * 比猜端口可靠：页面每几秒就长轮询一次，启动后很快就能拿到。
     */
    function learnPort(req) {
      if (selfPort) return
      try {
        const host = req && req.headers && (req.headers.host || req.headers.Host)
        if (!host) return
        const m = String(host).match(/:(\d{2,5})$/)
        if (m) selfPort = Number(m[1]) || 0
      } catch (e) { /* ignore */ }
    }

    /** 把一条通知放进长轮询队列并唤醒所有挂起的等待者（页面随即渲染）。 */
    function enqueueVisible(item) {
      queue.push(item)
      if (queue.length > MAX_QUEUE) queue.shift()
      while (waiters.length) {
        const w = waiters.shift()
        try { if (w.dispose) w.dispose() } catch (e) { /* ignore */ }
        try { w.resolve({ items: [item], seq: seq }) } catch (e) { /* ignore */ }
      }
    }

    /** 把一条通知投递给 Client；system 由 Client 负责操作系统通知。 */
    function pushItem(item, level) {
      if (level === 'system') {
        item.delivery = 'system'
        enqueueVisible(item)
        return { mode: 'system', carded: false }
      }
      const mode = topmostMode()
      if (mode === 'card') {
        spawnCard(item).then((r) => {
          if (!r || !r.ok) {
            // 卡片没起来时回退到应用内浮层，并尽力抬起 dsh 窗口。
            enqueueVisible(item)
            holdTopmost()
          }
        }).catch(() => { enqueueVisible(item); holdTopmost() })
        return { mode: mode, carded: null } // carded 由 spawnCard 异步决定
      }
      if (mode === 'window') {
        holdTopmost()
      }
      enqueueVisible(item)
      return { mode: mode, carded: false }
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
      pushItem(item, level)
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

    // Pending intents contain plain data so a replacement can finish an event
    // already received by its predecessor without retaining old code callbacks.
    function finishPending(intent, makeTitle = () => intent.title, makeBody = () => intent.body) {
      const titleRead = boundedRead(() => readTitle(intent.sessionId), undefined)
      const summaryRead = intent.includeSummary && config.showSummary
        ? boundedRead(() => readSummary(intent.sessionId), '') : Promise.resolve('')
      Promise.all([titleRead, summaryRead]).then(([title, summary]) => {
        if (disposed) return
        const index = runtime.pending.indexOf(intent)
        if (index < 0) return
        const body = intent.includeSummary && config.showSummary ? appendSummary(makeBody(title), summary) : makeBody(title)
        runtime.pending.splice(index, 1)
        notify(intent.category, intent.sessionId, makeTitle(title), body, intent.focus)
      }).catch(() => { /* leave the plain intent for a later replacement */ })
    }

    function enqueueAfterTitle(category, sessionId, makeTitle, makeBody, focusAtEvent, includeSummary) {
      if (disposed) return
      const intent = { category, sessionId: sessionId || null, title: makeTitle(), body: makeBody(), focus: focusAtEvent || snapshotFocus(sessionId), includeSummary: !!includeSummary }
      runtime.pending.push(intent)
      if (runtime.pending.length > MAX_QUEUE) runtime.pending.shift()
      finishPending(intent, makeTitle, makeBody)
    }

    // ---------- HTTP 路由（页面静态 client 的访问面） ----------
    // 关键诊断：webServer 服务不可用时，host 无法响应 client 的 fetch，
    // 表现为「设置页能看到、但测试通知与真实通知都不弹」。这里显式报错并跳过注册。
    if (!ctx.webServer || typeof ctx.webServer.register !== 'function') {
      console.error('[dsh-task-toast] FATAL: ctx.webServer 不可用 —— 无法注册 HTTP 路由，client 长轮询将全部失败（测试通知/任务通知不会弹出）。请确认 dsh 版本是否提供 webServer 服务。')
    } else {
      const safeRegister = (label, spec) => {
        try {
          ctx.effect(() => ctx.webServer.register(spec))
        } catch (e) {
          console.error('[dsh-task-toast] 注册路由失败 ' + label + ':', e && e.message ? e.message : e)
        }
      }

      safeRegister('/state', {
        kind: 'exact',
        path: '/dsh-task-toast/state',
        handler: (req, res) => {
          if (req.method !== 'GET') { sendJson(res, 405, { ok: false }); return }
          sendJson(res, 200, { config: config, streamId: runtime.streamId })
        },
      })

      safeRegister('/config', {
        kind: 'exact',
        path: '/dsh-task-toast/config',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          const body = await readJson(req)
          if (disposed) { sendJson(res, 503, { ok: false }); return }
          config = normalizeConfig(body && body.config)
          runtime.config = config
          sendJson(res, 200, { ok: true, config: config })
        },
      })

      safeRegister('/activate', {
        kind: 'exact',
        path: '/dsh-task-toast/activate',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          if (!isDesktopActivationRequest(req)) { sendJson(res, 403, { ok: false }); return }
          const result = await activateDesktopWindow()
          sendJson(res, 200, result)
        },
      })

      safeRegister('/active', {
        kind: 'exact',
        path: '/dsh-task-toast/active',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          const body = await readJson(req)
          const activeSession = updateActiveClient(body)
          sendJson(res, 200, { ok: true, activeSession: activeSession })
        },
      })

      safeRegister('/test', {
        kind: 'exact',
        path: '/dsh-task-toast/test',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          const body = await readJson(req)
          const t = i18n(config)
          const sessionId = body && typeof body.sessionId === 'string' && body.sessionId.length <= 200
            ? body.sessionId || null
            : null
          const item = {
            seq: ++seq,
            category: 'test',
            sessionId: sessionId,
            title: t.testTitle,
            body: t.testBody,
          }
          if (config.categories.task === 'system') {
            item.delivery = 'system'
            enqueueVisible(item)
            sendJson(res, 200, { ok: true, mode: 'system', queued: true })
            return
          }
          const mode = topmostMode()
          if (mode === 'card') {
            // 等卡片真正「窗口已显示」再答复，失败时把原因带回给页面
            const r = await spawnCard(item)
            sendJson(res, 200, {
              ok: true, mode: mode, carded: r.ok, cardSupported: cardSupported(),
              stage: r.stage || undefined, error: r.error || undefined, stderr: r.stderr || undefined,
            })
            return
          }
          if (mode === 'window') holdTopmost()
          enqueueVisible(item)
          sendJson(res, 200, { ok: true, mode: mode, carded: false, cardSupported: cardSupported() })
        },
      })

      safeRegister('/poll', {
        kind: 'exact',
        path: '/dsh-task-toast/poll',
        handler: (req, res) => {
          if (req.method !== 'GET') { sendJson(res, 405, { ok: false }); return }
          learnPort(req)
          let since = 0
          try {
            const url = new URL(req.url, 'http://localhost')
            since = Number(url.searchParams.get('since')) || 0
          } catch (e) { /* ignore */ }
          // A fresh Host process starts a new stream; do not wait against a
          // cursor belonging to the previous process.
          try {
            const requestedStream = new URL(req.url, 'http://localhost').searchParams.get('stream')
            if (requestedStream && requestedStream !== runtime.streamId) since = 0
          } catch { /* keep the numeric cursor */ }
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
          sendJson(res, 200, Object.assign({
            ok: true,
            updateProvider: 'dshmarket',
            profile: resolveProfile(),
            repo: REPO,
            mode: topmostMode(),
            cardSupported: cardSupported(),
            cardSelfTest: cardSelfTest,
            lastCard: lastCard,
            cardLogPath: cardLogPath(),
            cardLog: readCardLog(1200),
          }, { local: LOCAL_VERSION, hasUpdate: false }))
        },
      })

      safeRegister('/check-update', {
        kind: 'exact',
        path: '/dsh-task-toast/check-update',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          sendJson(res, 410, { ok: false, code: 'market-managed-updates', provider: 'dshmarket' })
        },
      })

      safeRegister('/update', {
        kind: 'exact',
        path: '/dsh-task-toast/update',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          sendJson(res, 410, { ok: false, code: 'market-managed-updates', provider: 'dshmarket' })
        },
      })

      safeRegister('/topmost', {
        kind: 'exact',
        path: '/dsh-task-toast/topmost',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          learnPort(req)
          const body = await readJson(req)
          const action = body && body.action === 'restore' ? 'restore' : body && body.action === 'probe' ? 'probe' : 'hold'
          if (action === 'restore') {
            releaseTopmost()
            sendJson(res, 200, { ok: true, action: 'restore' })
            return
          }
          if (action === 'probe') {
            // 探针：卡片模式下弹一张示例卡片并等结果；窗口模式下抬 3 秒后自动还原
            if (topmostMode() === 'card') {
              if (!cardSupported()) { sendJson(res, 200, { ok: false, mode: 'card', error: 'card script unavailable' }); return }
              const t = i18n(config)
              const r = await spawnCard({
                seq: ++seq,
                category: 'test',
                sessionId: null,
                title: t.testTitle,
                body: t.cardProbeBody,
              })
              sendJson(res, 200, { ok: r.ok, mode: 'card', action: 'probe', error: r.error || undefined, stderr: r.stderr || undefined })
              return
            }
            const rp = await runTopmost('topmost', 3000)
            sendJson(res, 200, Object.assign({ action: 'probe', mode: 'window' }, rp))
            return
          }
          const r = await runTopmost('topmost')
          sendJson(res, 200, Object.assign({ action: action }, r))
        },
      })

      // 卡片按钮回调：view = 跳转会话；later = 5 分钟后重新提醒；ignore = 丢弃
      safeRegister('/card-action', {
        kind: 'exact',
        path: '/dsh-task-toast/card-action',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          if (!isCardActionRequest(req)) { sendJson(res, 403, { ok: false }); return }
          learnPort(req)
          const body = await readJson(req)
          const id = body && body.id !== undefined ? String(body.id) : ''
          const action = body && typeof body.action === 'string' ? body.action : ''
          const item = cardItems.get(id) || null
          if (!item) { sendJson(res, 404, { ok: false, error: 'card-unavailable' }); return }
          cardItems.delete(id)
          console.log('[dsh-task-toast] 卡片回调：action=' + action + ' id=' + id)

          if (action === 'view') {
            const sessionId = item.sessionId || null
            const request = ++latestCardView
            const activation = await activateDesktopWindow()
            if (disposed) { sendJson(res, 503, { ok: false, error: 'plugin-reloading' }); return }
            if (request === latestCardView) {
              const navigation = { seq: ++seq, kind: 'card-view', category: 'noop', sessionId, title: '', body: '', silent: true, activation }
              queue.push(navigation)
              if (queue.length > MAX_QUEUE) queue.shift()
              while (waiters.length) {
                const w = waiters.shift()
                try { if (w.dispose) w.dispose() } catch (e) { /* ignore */ }
                try { w.resolve({ items: [navigation], seq: seq }) } catch (e) { /* ignore */ }
              }
            }
            sendJson(res, 200, { ok: activation.ok, action: 'view', sessionId: sessionId, activation })
            return
          }

          if (action === 'later' && item) {
            if (ctx.timer && typeof ctx.timer.timeout === 'function') {
              ctx.timer.timeout(() => {
                if (disposed) return
                notify(item.category, item.sessionId, item.title, item.body)
              }, 5 * 60 * 1000)
            }
            sendJson(res, 200, { ok: true, action: 'later', snoozeMs: 5 * 60 * 1000 })
            return
          }

          sendJson(res, 200, { ok: true, action: action || 'ignore' })
        },
      })

      safeRegister('/card', {
        kind: 'exact',
        path: '/dsh-task-toast/card',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          learnPort(req)
          const body = await readJson(req)
          const action = body && body.action === 'close-all' ? 'close-all' : 'probe'
          if (action === 'close-all') {
            closeAllCards()
            sendJson(res, 200, { ok: true, action: action })
            return
          }
          if (!cardSupported()) { sendJson(res, 200, { ok: false, error: 'card script unavailable' }); return }
          const t = i18n(config)
          const r = await spawnCard({
            seq: ++seq,
            category: 'test',
            sessionId: null,
            title: t.testTitle,
            body: t.cardProbeBody,
          })
          sendJson(res, 200, { ok: r.ok, mode: topmostMode(), error: r.error || undefined, stderr: r.stderr || undefined })
        },
      })

      // 通知中心：拉取 / 清空历史（持久化于本地文件，重启不丢）
      safeRegister('/history', {
        kind: 'exact',
        path: '/dsh-task-toast/history',
        handler: (req, res) => {
          if (req.method !== 'GET') { sendJson(res, 405, { ok: false }); return }
          sendJson(res, 200, { ok: true, items: loadHistory() })
        },
      })

      safeRegister('/history/clear', {
        kind: 'exact',
        path: '/dsh-task-toast/history/clear',
        handler: (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          clearHistory()
          sendJson(res, 200, { ok: true })
        },
      })

      console.log('[dsh-task-toast] host 已挂载：14 条 HTTP 路由（/dsh-task-toast/{state,config,activate,active,test,poll,version,check-update,update,topmost,card,card-action,history,history/clear}）注册完成。')
      console.log('[dsh-task-toast] 通知呈现方式 = ' + topmostMode() + '（card 独立卡片 / window 抬窗口 / off 关闭）；卡片脚本可用 = ' + cardSupported())
    }

    // ---------- 启动卡片自检（4s 后执行，避免与 dsh 启动抢资源） ----------
    if (topmostMode() === 'card' && cardSupported()) {
      if (ctx.timer && typeof ctx.timer.timeout === 'function') ctx.timer.timeout(runCardSelfTest, 4000)
      else runCardSelfTest()
    }

    // ---------- 事件源（静态 Host 共享任务通知管线） ----------
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

    ctx.on('agent/error', (payload) => {
      try {
        const sessionId = payload && payload.agent ? payload.agent.id : undefined
        const focusAtEvent = clearStreamingSession(sessionId)
        const t = i18n(config)
        enqueueAfterTitle('error', sessionId, (s) => t.error(s), () => t.errorBody(safeMessage(payload && payload.error)), focusAtEvent)
      } catch (e) { console.error(e) }
    })

    // Resume intents left by an unloaded Host after all routes and listeners exist.
    for (const intent of runtime.pending.slice()) finishPending(intent)

    // 停止 / 更新时：结束所有挂起的长轮询，防止悬空响应
    ctx.effect(() => {
      return () => {
        disposed = true
        runtime.seq = seq
        runtime.config = config
        releaseTopmost()
        closeAllCards()
        while (waiters.length) {
          const w = waiters.shift()
          try { if (w.dispose) w.dispose() } catch (e) { /* ignore */ }
          try { w.resolve({ items: [], seq: seq }) } catch (e) { /* ignore */ }
        }
      }
    })
  },
}
