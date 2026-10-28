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
import { copyFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

// 置顶脚本位置：lib/index.js → 插件根 → scripts/topmost.ps1
let TOPMOST_SCRIPT = ''
try {
  TOPMOST_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'topmost.ps1')
} catch (e) { /* 无法解析时置顶功能自动跳过 */ }

// 独立卡片脚本位置：scripts/card.ps1（WinForms 无边框置顶浮窗）
let CARD_SCRIPT = ''
try {
  CARD_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'card.ps1')
} catch (e) { /* ignore */ }

// 插件根目录（lib/index.js 的上一级），自更新时用于定位要覆盖的文件
let PLUGIN_ROOT = ''
try {
  PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
} catch (e) { /* ignore */ }

// 自更新只覆盖这几个运行时文件：其余文件（package.json / README）保持安装时的状态，
// 避免破坏 pnpm 的依赖树或 Electron 对 desktop profile 的管理。
const SELF_UPDATE_FILES = [
  'lib/index.js',
  'lib/client.js',
  'lib/config.js',
  'scripts/topmost.ps1',
  'scripts/card.ps1',
]

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
    cardProbeBody: 'If this card floats above every window, the standalone card works. Click any button to close it.',
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
    /** 更新命令作用的 profile：显式配置优先，否则用安装路径推断值，最后回落 web。 */
    function resolveProfile() {
      const explicit = config.profile && String(config.profile).trim()
      return explicit || DETECTED_PROFILE || 'web'
    }
    function currentUpdateCmd() {
      return buildUpdateCommand(resolveProfile())
    }

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
    let selfPort = 0                 // 从任意一条入站请求的 Host 头里学到的监听端口
    // 最近一次卡片结果（/version 暴露给设置页：卡片没弹出来时能直接看到原因）
    let lastCard = { at: 0, ok: false, error: '尚未弹出过卡片' }

    function cardSupported() {
      if (process.platform !== 'win32' || !CARD_SCRIPT) return false
      try { return existsSync(CARD_SCRIPT) } catch (e) { return false }
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
        ]
        if (selfPort) args.push('-CallbackUrl', 'http://127.0.0.1:' + selfPort + '/dsh-task-toast/card-action')

        let child
        try {
          child = spawn('powershell', args, { windowsHide: true })
        } catch (e) {
          cardItems.delete(id)
          resolve({ ok: false, error: 'spawn: ' + ((e && e.message) || e), stderr: '' })
          return
        }

        const startedAt = Date.now()
        let settled = false
        let stderrBuf = ''
        let outBuf = ''
        let watchdog = null
        const release = () => {
          if (cardChildren.get(slot) === child) cardChildren.delete(slot)
        }
        cardChildren.set(slot, child)

        const settle = (ok, error) => {
          if (settled) return
          settled = true
          if (watchdog) { try { clearTimeout(watchdog) } catch (e) { /* ignore */ } }
          lastCard = { at: Date.now(), ok: ok, error: ok ? '' : String(error || 'unknown') }
          if (!ok) {
            console.warn('[dsh-task-toast] 独立卡片未显示（' + error + '），通知转回应用内呈现')
            if (stderrBuf) console.warn('[dsh-task-toast] 卡片 stderr：' + stderrBuf.slice(-600))
            cardItems.delete(id)
            try { child.kill() } catch (e) { /* ignore */ }
          } else {
            console.log('[dsh-task-toast] 独立卡片已显示 #' + cardSeq + '（slot ' + slot + '，' + cardTimeoutMs() + 'ms 后自动消失）')
          }
          resolve({ ok: ok, error: ok ? '' : String(error || 'unknown'), stderr: stderrBuf.slice(-300) })
        }

        // 5 秒没等到「窗口已显示」就判定失败（正常应在 1~2 秒内出现）
        watchdog = setTimeout(() => {
          settle(false, 'timeout: 卡片 5 秒内未报告窗口已显示（编译或启动卡住）')
        }, 5000)

        try {
          if (child.stderr) child.stderr.on('data', (d) => { stderrBuf += String(d); if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-2000) })
          if (child.stdout) child.stdout.on('data', (d) => {
            outBuf += String(d)
            if (outBuf.indexOf('"stage":"shown"') >= 0) { release(); settle(true, '') }
          })
        } catch (e) { /* ignore */ }

        child.on('error', (e) => settle(false, 'spawn error: ' + ((e && e.message) || e)))
        child.on('close', (code) => {
          release()
          if (!settled) {
            const tail = stderrBuf ? ' · ' + stderrBuf.slice(-160).replace(/\s+/g, ' ') : ''
            settle(false, '进程提前退出 code=' + code + '（耗时 ' + (Date.now() - startedAt) + 'ms）' + tail)
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
      return c.mode === 'card' || c.mode === 'window' || c.mode === 'off' ? c.mode : 'card'
    }

    // ---------- 卡片自检：启动后跑一次 `-SelfTest 1`（不创建窗口） ----------
    // 目的是把「卡片能不能用」提前暴露到日志里，而不是等真实通知才发现。
    let cardSelfTest = 'pending'
    function runCardSelfTest() {
      if (!cardSupported()) { cardSelfTest = 'unsupported'; return }
      let child
      try {
        child = spawn('powershell', [
          '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass',
          '-File', CARD_SCRIPT, '-SelfTest', '1',
        ], { windowsHide: true })
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

    /**
     * 从 GitHub Contents API 下载指定 ref 的运行时文件，写入插件目录（自更新）。
     * 不触碰 package.json / node_modules，因此 desktop profile 的独占管理不受影响。
     */
    async function downloadFrom(ref) {
      const plan = []
      for (const rel of SELF_UPDATE_FILES) {
        const url = 'https://api.github.com/repos/' + REPO + '/contents/' + rel + '?ref=' + encodeURIComponent(ref)
        const ctrl = new AbortController()
        const to = setTimeout(() => { try { ctrl.abort() } catch (e) { /* ignore */ } }, 15000)
        try {
          const res = await fetch(url, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-task-toast' },
            signal: ctrl.signal,
          })
          if (!res.ok) throw new Error(rel + ': HTTP ' + res.status)
          const j = await res.json()
          if (!j || typeof j.content !== 'string') throw new Error(rel + ': no content field')
          const buf = Buffer.from(j.content, j.encoding === 'base64' ? 'base64' : 'utf8')
          if (!buf.length) throw new Error(rel + ': empty file')
          plan.push({ rel: rel, buf: buf })
        } finally {
          clearTimeout(to)
        }
      }
      // 一致性校验：新 config 里必须带 VERSION，避免拉到半套文件
      const cfgFile = plan.find((p) => p.rel === 'lib/config.js')
      const verMatch = cfgFile ? cfgFile.buf.toString('utf8').match(/VERSION = '([^']+)'/) : null
      if (!verMatch) throw new Error('downloaded lib/config.js has no VERSION constant')
      const newVersion = verMatch[1]

      const lines = []
      for (const item of plan) {
        const dest = join(PLUGIN_ROOT, item.rel)
        mkdirSync(dirname(dest), { recursive: true })
        if (existsSync(dest)) copyFileSync(dest, dest + '.bak')
        writeFileSync(dest, item.buf)
        lines.push('✓ ' + item.rel + '  ' + item.buf.length + ' B')
      }

      // 同步 package.json 的 version 字段（只改这一个字段，保留 dependencies / dsh 配置），
      // 避免更新后版本号仍显示旧值、从而反复提示"有新版本"。
      try {
        const pkgPath = join(PLUGIN_ROOT, 'package.json')
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
          if (pkg.version !== newVersion) {
            pkg.version = newVersion
            copyFileSync(pkgPath, pkgPath + '.bak')
            writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
            lines.push('✓ package.json version → ' + newVersion)
          }
        }
      } catch (e) {
        lines.push('⚠ package.json 版本号未更新：' + ((e && e.message) || e))
      }

      return { ok: true, mode: 'self', ref: ref, version: newVersion, log: lines.join('\n') }
    }

    /** 自更新：先试对应的 tag，失败回落 master。 */
    async function selfUpdate() {
      if (process.env.DSH_TT_SKIP_SELF_UPDATE === '1') return { ok: false, error: 'self-update skipped by env' }
      if (!PLUGIN_ROOT) return { ok: false, error: 'plugin root unknown' }
      const refs = []
      if (updateState.latest) refs.push('v' + updateState.latest)
      refs.push('master')
      let lastError = null
      for (const ref of refs) {
        try {
          return await downloadFrom(ref)
        } catch (e) {
          lastError = e
          console.warn('[dsh-task-toast] 自更新 ref=' + ref + ' 失败：' + ((e && e.message) || e))
        }
      }
      return { ok: false, error: (lastError && lastError.message) || 'download failed' }
    }

    /** 一键更新：优先自更新（覆盖运行时文件），失败再回退 dsh plugin 命令。 */
    async function performUpdate() {
      const target = updateState.latest || ''
      const steps = []

      const su = await selfUpdate().catch((e) => ({ ok: false, error: (e && e.message) || String(e) }))
      if (su && su.ok) {
        steps.push('自更新完成（' + su.version + '，ref=' + su.ref + '）：\n' + su.log)
        steps.push('需要重启 dsh 才会加载新版本。')
        return { ok: true, mode: 'self', version: su.version, log: steps.join('\n\n'), profile: resolveProfile() }
      }
      steps.push('自更新失败：' + ((su && su.error) || 'unknown') + '\n回退到 dsh plugin 命令…')

      const profile = resolveProfile()
      const removeCmd = 'dsh plugin --profile ' + profile + ' remove dsh-task-toast'
      const addCmd = 'dsh plugin --profile ' + profile + ' add ' + INSTALL_SOURCE
      const remove = await runShell(removeCmd)
      steps.push('$ ' + removeCmd + '\n' + (remove.out || '') + (remove.err || ''))
      const add = await runShell(addCmd)
      steps.push('$ ' + addCmd + '\n' + (add.out || '') + (add.err || ''))
      const ok = remove.code === 0 && add.code === 0
      return { ok: ok, mode: 'cli', log: steps.join('\n\n'), removeCode: remove.code, addCode: add.code, profile: profile }
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

    /**
     * 把一条通知投递出去：
     *   · card   → 独立卡片呈现；卡片失败时自动转回应用内（通知永不丢失）
     *   · window → 抬 dsh 窗口 + 应用内呈现
     *   · off    → 仅应用内呈现
     */
    function pushItem(item) {
      const mode = topmostMode()
      if (mode === 'card') {
        spawnCard(item).then((r) => {
          if (!r || !r.ok) { enqueueVisible(item); holdTopmost() }
        }).catch(() => { enqueueVisible(item); holdTopmost() })
        return { mode: mode, carded: null } // carded 由 spawnCard 异步决定
      }
      if (mode === 'window') holdTopmost()
      enqueueVisible(item)
      return { mode: mode, carded: false }
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
      pushItem(item)
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
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          const t = i18n(config)
          const item = {
            seq: ++seq,
            category: 'test',
            sessionId: null,
            title: t.testTitle,
            body: t.testBody,
          }
          const mode = topmostMode()
          if (mode === 'card') {
            // 等卡片真正「窗口已显示」再答复，失败时把原因带回给页面
            const r = await spawnCard(item)
            sendJson(res, 200, {
              ok: true, mode: mode, carded: r.ok, cardSupported: cardSupported(),
              error: r.error || undefined, stderr: r.stderr || undefined,
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
          sendJson(res, 200, Object.assign({ ok: true, updateCmd: currentUpdateCmd(), profile: resolveProfile(), repo: REPO, mode: topmostMode(), cardSupported: cardSupported(), cardSelfTest: cardSelfTest, lastCard: lastCard }, updateState))
        },
      })

      safeRegister('/check-update', {
        kind: 'exact',
        path: '/dsh-task-toast/check-update',
        handler: async (req, res) => {
          if (req.method !== 'POST') { sendJson(res, 405, { ok: false }); return }
          const st = await checkUpdate(true)
          sendJson(res, 200, Object.assign({ ok: true, updateCmd: currentUpdateCmd(), profile: resolveProfile(), repo: REPO }, st))
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
          learnPort(req)
          const body = await readJson(req)
          const id = body && body.id !== undefined ? String(body.id) : ''
          const action = body && typeof body.action === 'string' ? body.action : ''
          const item = cardItems.get(id) || null
          cardItems.delete(id)
          console.log('[dsh-task-toast] 卡片回调：action=' + action + ' id=' + id)

          if (action === 'view') {
            const sessionId = (item && item.sessionId) || (body && body.sessionId) || null
            // 1) 通知页面跳转到对应会话（页面不在前台也能在下次轮询时补上）
            queue.push({ seq: ++seq, kind: 'card-view', category: 'noop', sessionId: sessionId, title: '', body: '', silent: true })
            while (waiters.length) {
              const w = waiters.shift()
              try { if (w.dispose) w.dispose() } catch (e) { /* ignore */ }
              try { w.resolve({ items: queue[queue.length - 1], seq: seq }) } catch (e) { /* ignore */ }
            }
            // 2) 同时把 dsh 窗口顶到前面 —— 用户点「查看结果」就是想看它
            runTopmost('topmost', 2500).catch(() => { /* ignore */ })
            sendJson(res, 200, { ok: true, action: 'view', sessionId: sessionId })
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

      console.log('[dsh-task-toast] host 已挂载：11 条 HTTP 路由（/dsh-task-toast/{state,config,active,test,poll,version,check-update,update,topmost,card,card-action}）注册完成。')
      console.log('[dsh-task-toast] 通知呈现方式 = ' + topmostMode() + '（card 独立卡片 / window 抬窗口 / off 关闭）；卡片脚本可用 = ' + cardSupported())
    }

    // ---------- 启动卡片自检（4s 后执行，避免与 dsh 启动抢资源） ----------
    if (topmostMode() === 'card' && cardSupported()) {
      if (ctx.timer && typeof ctx.timer.timeout === 'function') ctx.timer.timeout(runCardSelfTest, 4000)
      else runCardSelfTest()
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
        releaseTopmost()
        closeAllCards()
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
