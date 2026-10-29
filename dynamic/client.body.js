// 由 scripts/build-dynamic.mjs 生成 —— 可直接作为 cordis_define 的 code.client 函数体。
// src/config.js
// dsh-task-toast —— 共享配置与纯函数（位置 / 语言 / 查看行为 / 分类级别 / 默认值 / 配置归一化）。
//
// ⚠️ 构建说明：build-static.mjs 会把本文件内容内联进 lib/client.js（去掉 export 关键字，
// 转为顶层 const/function）；build-dynamic.mjs 也会内联进 dynamic/*.body.js。
// 因此这里只能包含无任何运行时依赖的常量与函数（不能 import 其他模块、不能引用
// ctx / React / host 等宿主符号）。

/** 插件版本（与 package.json 保持同步；Host 侧会优先读真实 package.json）。 */
const VERSION = '1.9.1'

/** 上游仓库 owner/repo —— 更新检查与更新命令都基于它。 */
const REPO = 'LouieKeung-13/dsh-task-toast'

/** dsh 安装源（更新命令用）。 */
const INSTALL_SOURCE = 'github:' + REPO

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

/** 浮层主题：auto 跟随系统 / light 浅色 / dark 深色。 */
const THEMES = [
  { id: 'auto', zh: '跟随系统', en: 'System' },
  { id: 'light', zh: '浅色', en: 'Light' },
  { id: 'dark', zh: '深色', en: 'Dark' },
]
const THEME_IDS = THEMES.map((t) => t.id)

/** 置顶/卡片落地方式。 */
const TOPMOST_MODES = [
  { id: 'card', zh: '独立置顶小卡片', en: 'Standalone floating card' },
  { id: 'window', zh: '提升 dsh 窗口', en: 'Raise the dsh window' },
  { id: 'off', zh: '关闭（仅应用内）', en: 'Off (in-app only)' },
]
const TOPMOST_MODE_IDS = TOPMOST_MODES.map((m) => m.id)

/** 通知分类：task = 任务完成；error = 错误失败；update = 插件自身有新版本。 */
const CATEGORIES = [
  { id: 'task', zh: '任务完成', en: 'Task completed', def: 'app' },
  { id: 'error', zh: '错误失败', en: 'Error', def: 'off' },
  { id: 'update', zh: '插件更新', en: 'Plugin update', def: 'app' },
]
const CATEGORY_KEYS = CATEGORIES.map((c) => c.id)

/** 通知级别：off 关闭 / app 仅应用内 toast / system 系统通知 + toast。 */
const LEVELS = [
  { id: 'off', zh: '关闭', en: 'Off' },
  { id: 'app', zh: '应用内提示', en: 'In-app toast' },
  { id: 'system', zh: '系统通知', en: 'System notification' },
]
const LEVEL_IDS = LEVELS.map((l) => l.id)

/** 配置预设：一键批量设置分类级别，降低 7×3 逐个配置的负担。 */
const PRESETS = [
  { id: 'important', zh: '仅重要', en: 'Important only' },
  { id: 'all', zh: '全部开启', en: 'All on' },
  { id: 'off', zh: '全部关闭', en: 'All off' },
]
const PRESET_IDS = PRESETS.map((p) => p.id)

/**
 * 按预设 id 计算分类级别映射（仅覆盖已知分类，不影响其它字段）。
 * - important：任务完成 + 错误失败 = 应用内提示；插件更新 = 关闭（更新提醒低频、易打扰）
 * - all：全部应用内提示
 * - off：全部关闭
 */
function applyPreset(id) {
  if (id === 'all') {
    return { task: 'app', error: 'app', update: 'app' }
  }
  if (id === 'off') {
    return { task: 'off', error: 'off', update: 'off' }
  }
  // important（默认）
  return { task: 'app', error: 'app', update: 'off' }
}

/** 判断当前分类配置是否匹配某个预设（用于设置页回显已选预设）。 */
function matchPreset(cats) {
  if (!cats || typeof cats !== 'object') return ''
  const want = (id) => applyPreset(id)
  for (const id of PRESET_IDS) {
    const p = want(id)
    let same = true
    for (const k of CATEGORY_KEYS) {
      if ((cats[k] || 'off') !== (p[k] || 'off')) { same = false; break }
    }
    if (same) return id
  }
  return ''
}

/** 默认配置（与设置页首次打开时一致）。 */
const DEFAULT_CONFIG = {
  enabled: true,
  locale: 'zh',
  theme: 'auto',
  followAccent: false,
  position: 'bottom-right',
  viewBehavior: 'navigate',
  showSummary: true,
  onlyOtherSessions: true,
  autoDismissMs: 10000,
  categories: {
    task: 'app',
    error: 'off',
    update: 'app',
  },
  // ---- 更新检查 ----
  checkUpdate: true,        // 开关：是否在 Host 启动时 / 周期性检查上游新版本
  updateIntervalHours: 6,   // 自动检查间隔（小时）
  profile: '',              // 更新命令作用的 dsh profile；留空 = 从插件安装路径自动识别
  // ---- 置顶（跨应用） ----
  // mode = card   ：弹出**独立的无边框小卡片**（WinForms 原生窗口，真·置顶、不抢焦点）
  // mode = window ：把 dsh 主窗口整体抬到所有应用之上（旧行为）
  // mode = off    ：不出现在应用外，只保留应用内浮层
  topmost: {
    mode: 'card',
    enabled: true,          // 兼容字段，等价于 mode !== 'off'
    durationMs: 0,          // 卡片自动消失 / 置顶保持时长（ms），0 = 跟随浮层自动消失时长(autoDismissMs)
    matchTitle: 'DeepSeek', // 按 PID 找不到窗口时的兜底匹配（窗口标题包含）
    // 弹卡片的同时也发一条 Windows 原生通知（横幅 + 通知中心）。
    // 卡片起不来时它还是兜底通道 —— 通知不会因为卡片失败而丢。
    alsoSystemToast: true,
  },
  accent: '',               // 卡片强调色（#RRGGBB）；空 = 用默认蓝，followAccent 时由页面回传
}

/** 生成更新命令（两行，兼容不识别 `&&` 的 shell）。profile 省略时用 web。 */
function buildUpdateCommand(profile) {
  const p = profile && String(profile).trim() ? String(profile).trim() : 'web'
  return [
    'dsh plugin --profile ' + p + ' remove dsh-task-toast',
    'dsh plugin --profile ' + p + ' add ' + INSTALL_SOURCE,
  ].join('\n')
}

/** 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0（容忍 v 前缀与缺失段）。 */
function compareVersion(a, b) {
  const pa = String(a == null ? '' : a).replace(/^v/i, '').split('.')
  const pb = String(b == null ? '' : b).replace(/^v/i, '').split('.')
  for (let i = 0; i < 3; i += 1) {
    const na = parseInt(pa[i], 10)
    const nb = parseInt(pb[i], 10)
    const va = isNaN(na) ? 0 : na
    const vb = isNaN(nb) ? 0 : nb
    if (va > vb) return 1
    if (va < vb) return -1
  }
  return 0
}

/** 仅接受合法级别，其余一律收敛为 'off'。 */
function sanitizeLevel(v) {
  return LEVEL_IDS.indexOf(v) >= 0 ? v : 'off'
}

/** 归一化置顶配置（兼容旧配置中不存在该字段的情况）。 */
function normalizeTopmost(input) {
  const src = input && typeof input === 'object' ? input : {}
  const d = DEFAULT_CONFIG.topmost
  let mode
  if (TOPMOST_MODE_IDS.indexOf(src.mode) >= 0) mode = src.mode
  else if (src.enabled === false) mode = 'off'
  else mode = d.mode
  return {
    mode: mode,
    enabled: mode !== 'off',
    durationMs:
      typeof src.durationMs === 'number'
        ? Math.max(0, Math.min(120000, src.durationMs | 0))
        : d.durationMs,
    matchTitle:
      typeof src.matchTitle === 'string'
        ? src.matchTitle.slice(0, 60)
        : d.matchTitle,
    alsoSystemToast:
      src.alsoSystemToast === undefined ? d.alsoSystemToast : src.alsoSystemToast !== false,
  }
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
    theme: THEME_IDS.indexOf(src.theme) >= 0 ? src.theme : DEFAULT_CONFIG.theme,
    followAccent: src.followAccent === undefined ? DEFAULT_CONFIG.followAccent : src.followAccent !== false,
    position: POSITION_IDS.indexOf(src.position) >= 0 ? src.position : DEFAULT_CONFIG.position,
    viewBehavior: VIEW_BEHAVIOR_IDS.indexOf(src.viewBehavior) >= 0 ? src.viewBehavior : DEFAULT_CONFIG.viewBehavior,
    showSummary: src.showSummary === undefined ? DEFAULT_CONFIG.showSummary : src.showSummary !== false,
    onlyOtherSessions:
      src.onlyOtherSessions === undefined ? DEFAULT_CONFIG.onlyOtherSessions : src.onlyOtherSessions !== false,
    autoDismissMs:
      typeof src.autoDismissMs === 'number'
        ? Math.max(2000, Math.min(60000, src.autoDismissMs | 0))
        : DEFAULT_CONFIG.autoDismissMs,
    checkUpdate: src.checkUpdate === undefined ? DEFAULT_CONFIG.checkUpdate : src.checkUpdate !== false,
    updateIntervalHours:
      typeof src.updateIntervalHours === 'number'
        ? Math.max(1, Math.min(72, src.updateIntervalHours | 0))
        : DEFAULT_CONFIG.updateIntervalHours,
    topmost: normalizeTopmost(src.topmost),
    accent: typeof src.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(src.accent.trim())
      ? src.accent.trim()
      : DEFAULT_CONFIG.accent,
    profile: typeof src.profile === 'string' ? src.profile.trim().slice(0, 40) : DEFAULT_CONFIG.profile,
    categories: cats,
  }
}

/** 深拷贝一份默认配置（避免共享引用被意外改写）。 */
function cloneDefaultConfig() {
  return normalizeConfig(DEFAULT_CONFIG)
}
// src/client.js
// dsh-task-toast —— Client 半（浏览器页面，动态插件形态）。
//
// 通过 tt/poll 长轮询 Host 通知队列 → 应用内 toast（shell.overlay，四角可选位置）
// + 可选系统通知 → 点击「查看结果」跳转会话或浮层内展开；设置页（settings.section）
// 提供位置 / 语言 / 查看行为 / 分类级别等配置，并同步回 Host。
//
// 作为动态插件使用时，请粘贴构建产物 dynamic/client.body.js（npm run build:dynamic）。
// 本文件使用动态插件环境提供的全局 React / host / styles。

// ---------- 多语言 UI 文案 ----------
function ui(locale) {
  const zh = {
    settingsTitle: '任务提示',
    settingsHint: '任务完成时，在所选角落弹出提示窗口，可查看结果、稍后处理或忽略。设置仅作用于本机当前安装。',
    enable: '启用任务提示',
    language: '界面语言',
    position: '弹出位置',
    viewBehavior: '「查看结果」行为',
    showSummary: '显示结果摘要',
    onlyOther: '仅推送其他会话（当前正在查看的会话不提示）',
    autoDismiss: '自动消失（秒，0 表示不自动关闭）',
    taskLevel: '任务完成',
    errorLevel: '错误失败',
    levelOff: '关闭',
    levelApp: '应用内提示',
    levelSystem: '系统通知',
    testBtn: '发送测试通知',
    viewResult: '查看结果',
    later: '稍后',
    dismiss: '忽略',
    copy: '复制结果',
    // ---- 通知中心 ----
    history: '通知历史',
    historyTitle: '通知历史',
    clear: '清空',
    historyEmpty: '暂无历史记录',
    replay: '重播',
    // ---- 配置预设 ----
    preset: '快速预设',
    presetHint: '一键批量设置分类级别，降低逐项配置的负担。',
  }
  const en = {
    settingsTitle: 'Task notifications',
    settingsHint: 'When a task finishes, a prompt appears in the chosen corner. You can view the result, snooze, or dismiss it. Settings apply to this local install only.',
    enable: 'Enable task notifications',
    language: 'UI language',
    position: 'Overlay position',
    viewBehavior: '"View result" behavior',
    showSummary: 'Show result summary',
    onlyOther: 'Only other sessions (suppress the one you are viewing)',
    autoDismiss: 'Auto-dismiss (seconds, 0 = never)',
    taskLevel: 'Task completed',
    errorLevel: 'Error',
    levelOff: 'Off',
    levelApp: 'In-app toast',
    levelSystem: 'System notification',
    testBtn: 'Send test notification',
    viewResult: 'View result',
    later: 'Later',
    dismiss: 'Dismiss',
    copy: 'Copy result',
    // ---- Notification center ----
    history: 'History',
    historyTitle: 'Notification history',
    clear: 'Clear',
    historyEmpty: 'No history yet',
    replay: 'Replay',
    // ---- Presets ----
    preset: 'Quick preset',
    presetHint: 'Batch-set category levels in one tap to avoid configuring each one by hand.',
  }
  return locale === 'en' ? en : zh
}

return {
  async apply(ctx) {
    const state = {
      config: Object.assign({}, DEFAULT_CONFIG, { categories: Object.assign({}, DEFAULT_CONFIG.categories) }),
      toasts: [],
      seq: 0,
      toastCounter: 0,
      activeSession: null,
      disposed: false,
      focusedSeq: null, // 键盘焦点所在的 toast（←→/↑↓ 切换，Enter 查看，Esc 忽略）
      seqLocal: 0,     // 本地回放/预览用的递减序号（避免与 Host 的 seq 冲突）
    }
    const listeners = new Set()
    const emitter = {
      subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
      emit() { const arr = Array.from(listeners); for (const fn of arr) { try { fn() } catch (e) { /* ignore */ } } },
    }
    const snoozeTimers = new Map()

    const timer = ctx.get('timer')
    const sessions = ctx.get('sessions')
    const slots = ctx.get('slots')

    function openSession(id) {
      if (!id || !sessions || typeof sessions.open !== 'function') return
      try { sessions.open(id) } catch (e) { /* ignore */ }
    }

    function dismissToast(id) {
      state.toasts = state.toasts.filter((t) => t.id !== id)
      const tm = snoozeTimers.get(id)
      if (tm) { try { clearTimeout(tm) } catch (e) { /* ignore */ } snoozeTimers.delete(id) }
      emitter.emit()
    }

    function snoozeToast(toast) {
      const id = toast.id
      dismissToast(id)
      if (timer) {
        const tm = timer.timeout(() => {
          snoozeTimers.delete(id)
          if (state.disposed) return
          state.toasts = state.toasts.concat(toast).slice(-8)
          emitter.emit()
          if (toast.category !== 'test' && timer) timer.timeout(() => dismissToast(id), toast.lifetime || 10000)
        }, 60000)
        snoozeTimers.set(id, tm)
      }
    }

    // 相对时间（通知历史列表用）
    function timeAgo(ts) {
      if (!ts) return ''
      const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
      if (s < 60) return s + 's'
      if (s < 3600) return Math.floor(s / 60) + 'm'
      if (s < 86400) return Math.floor(s / 3600) + 'h'
      return Math.floor(s / 86400) + 'd'
    }

    function addToast(item, lifetime) {
      const base = {
        id: item.seq, ts: ++state.toastCounter, category: item.category,
        title: item.title, body: item.body, sessionId: item.sessionId,
        expanded: false, groupCount: item.groupCount || 1,
        lifetime: typeof lifetime === 'number' ? lifetime : (state.config.autoDismissMs || 0),
      }
      // 同会话 / 同分类的突发通知：用 replaceSeq 指向原 toast，原地更新而非新增，避免刷屏
      if (item.replaceSeq != null) {
        const idx = state.toasts.findIndex((t) => t.id === item.replaceSeq)
        if (idx >= 0) {
          const old = state.toasts[idx]
          base.id = old.id
          base.expanded = old.expanded
          base.groupCount = item.groupCount || old.groupCount || 1
          state.toasts = state.toasts.slice()
          state.toasts[idx] = base
          emitter.emit()
          if (base.lifetime > 0 && timer) {
            const tm = snoozeTimers.get(old.id)
            if (tm) { try { clearTimeout(tm) } catch (e) { /* ignore */ } snoozeTimers.delete(old.id) }
            timer.timeout(() => dismissToast(base.id), base.lifetime)
          }
          return
        }
      }
      state.toasts = state.toasts.concat(base).slice(-8)
      emitter.emit()
      if (base.lifetime > 0 && timer) timer.timeout(() => dismissToast(base.id), base.lifetime)
    }

    function showSystem(item) {
      if (typeof Notification === 'undefined') return
      try {
        if (Notification.permission !== 'granted') return
        const n = new Notification(item.title || 'DSH', { body: item.body || '', tag: 'dsh-tt-' + item.seq })
        n.onclick = () => { try { if (typeof window !== 'undefined' && window.focus) window.focus() } catch (e) { /* ignore */ } openSession(item.sessionId); n.close() }
      } catch (e) { /* ignore */ }
    }

    function handleItems(items) {
      for (const item of items) {
        if (item.category === 'test') { addToast(item, 10000); continue }
        const level = (state.config.categories || {})[item.category]
        if (level === 'off') continue
        if (level === 'system') showSystem(item)
        addToast(item, state.config.autoDismissMs || 0)
      }
    }

    async function pump() {
      while (!state.disposed) {
        try {
          const res = await host.call('tt/poll', { since: state.seq })
          let items = []
          if (res && Array.isArray(res.items)) items = res.items.filter((i) => i && typeof i.seq === 'number' && i.seq > state.seq)
          if (res && typeof res.seq === 'number') state.seq = res.seq
          if (items.length) handleItems(items)
        } catch (e) {
          console.error('task-toast poll failed', e)
          if (timer) await timer.timeout(1500)
        }
      }
    }

    try {
      const st = await host.call('tt/state', {})
      if (st && st.config) state.config = st.config
    } catch (e) { console.error('task-toast state failed', e) }
    pump()

    ctx.effect(() => { return () => { state.disposed = true } })

    function ActiveReporter(props) {
      const useSessions = props && props.useSessions
      if (typeof useSessions !== 'function') return null
      const current = useSessions((s) => s && s.current)
      React.useEffect(() => {
        const next = current || null
        if (next !== state.activeSession) {
          state.activeSession = next
          host.call('tt/active', { sessionId: next }).catch(() => { /* ignore */ })
        }
      }, [current])
      return null
    }

    function ToastStack() {
      const [items, setItems] = React.useState([])
      const [histOpen, setHistOpen] = React.useState(false)
      const [history, setHistory] = React.useState([])
      React.useEffect(() => emitter.subscribe(() => setItems(state.toasts)), [])
      const cfg = state.config
      const t = ui(cfg.locale)
      const themeClass = cfg.theme === 'light' ? ' dsh-tt-theme-light' : cfg.theme === 'dark' ? ' dsh-tt-theme-dark' : ''

      function loadHistory() { host.call('tt/history', {}).then((r) => { if (r && Array.isArray(r.items)) setHistory(r.items) }).catch(() => {}) }
      function toggleHistory() { const next = !histOpen; setHistOpen(next); if (next) loadHistory() }
      function clearHistory() { host.call('tt/history/clear', {}).then(() => setHistory([])).catch(() => {}) }
      function replayHist(h) {
        state.seqLocal -= 1
        addToast({ seq: state.seqLocal, category: h.category, sessionId: h.sessionId, title: h.title, body: h.body, groupCount: 1 }, 10000)
      }
      function doView(toast) {
        const canNav = cfg.viewBehavior === 'navigate' && !!toast.sessionId
        if (canNav) { openSession(toast.sessionId); dismissToast(toast.id) }
        else { const idx = state.toasts.findIndex((t2) => t2.id === toast.id); if (idx >= 0) { state.toasts[idx] = Object.assign({}, state.toasts[idx], { expanded: !state.toasts[idx].expanded }); emitter.emit() } }
      }

      // 键盘可达性：←→/↑↓ 在 toast 间移动焦点，Enter 查看，Esc 忽略（输入框聚焦时让位给原生输入）
      React.useEffect(() => {
        function onKey(e) {
          const el = (typeof document !== 'undefined') ? document.activeElement : null
          if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
          const toasts = state.toasts
          if (!toasts.length) return
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            let idx = toasts.findIndex((t2) => t2.id === state.focusedSeq)
            if (idx < 0) idx = toasts.length - 1
            else idx = (e.key === 'ArrowUp' || e.key === 'ArrowLeft')
              ? (idx - 1 + toasts.length) % toasts.length
              : (idx + 1) % toasts.length
            state.focusedSeq = toasts[idx].id
            emitter.emit()
          } else if (e.key === 'Enter') {
            const tt = toasts.find((x) => x.id === state.focusedSeq) || toasts[toasts.length - 1]
            if (tt) { e.preventDefault(); doView(tt) }
          } else if (e.key === 'Escape') {
            const tt = toasts.find((x) => x.id === state.focusedSeq) || toasts[toasts.length - 1]
            if (tt) { e.preventDefault(); dismissToast(tt.id); if (state.focusedSeq === tt.id) state.focusedSeq = null; emitter.emit() }
          }
        }
        if (typeof document !== 'undefined') document.addEventListener('keydown', onKey)
        return () => { if (typeof document !== 'undefined') document.removeEventListener('keydown', onKey) }
      }, [])

      function renderToast(toast) {
        const canNavigate = cfg.viewBehavior === 'navigate' && !!toast.sessionId
        const onView = () => doView(toast)
        const bodyClass = 'dsh-tt-body' + (toast.expanded ? ' dsh-tt-body--expanded' : '')
        const focused = state.focusedSeq === toast.id
        const focusStyle = focused ? { outline: '2px solid #0a84ff', outlineOffset: '2px' } : null
        const children = [
          React.createElement('div', { key: 'title', className: 'dsh-tt-title' },
            toast.title || '',
            toast.groupCount > 1 ? React.createElement('span', { key: 'g', className: 'dsh-tt-group-badge' }, '×' + toast.groupCount) : null
          ),
          (cfg.showSummary || toast.category === 'test') ? React.createElement('div', { key: 'body', className: bodyClass }, toast.body || '') : null,
          toast.expanded ? React.createElement('button', {
            key: 'copy', className: 'dsh-tt-btn dsh-tt-btn--primary', style: { flex: 'none', marginTop: '2px' },
            onClick: (e) => { e.stopPropagation(); try { if (navigator && navigator.clipboard) navigator.clipboard.writeText(toast.body || '') } catch (err) { /* ignore */ } },
          }, t.copy) : null,
          React.createElement('div', { key: 'actions', className: 'dsh-tt-actions' },
            React.createElement('button', { key: 'view', className: 'dsh-tt-btn dsh-tt-btn--primary', onClick: onView }, t.viewResult),
            React.createElement('button', { key: 'later', className: 'dsh-tt-btn', onClick: () => snoozeToast(toast) }, t.later),
            React.createElement('button', { key: 'dismiss', className: 'dsh-tt-btn', onClick: () => dismissToast(toast.id) }, t.dismiss)
          ),
        ].filter(Boolean)
        return React.createElement('div', {
          key: String(toast.id),
          className: 'dsh-tt-toast dsh-tt-' + String(toast.category || 'x'),
          style: focusStyle,
          title: toast.sessionId ? t.viewResult + ' · ' + toast.sessionId : '',
        }, children)
      }

      // 常驻铃铛（通知中心入口，随时可回看历史）
      const bellBtn = React.createElement('button', {
        key: 'bell', className: 'dsh-tt-bell', onClick: toggleHistory, title: t.history,
      }, [
        React.createElement('svg', { key: 'i', viewBox: '0 0 24 24', width: '18', height: '18', fill: 'currentColor' },
          React.createElement('path', { d: 'M12 2a6 6 0 0 0-6 6v3.586l-1.707 1.707A1 1 0 0 0 5 15h14a1 1 0 0 0 .707-1.707L18 11.586V8a6 6 0 0 0-6-6zm0 20a3 3 0 0 0 3-3H9a3 3 0 0 0 3 3z' })),
        history.length ? React.createElement('span', { key: 'b', className: 'dsh-tt-bell-badge' }, String(history.length > 99 ? '99+' : history.length)) : null,
      ])

      const histPanel = histOpen ? React.createElement('div', { key: 'hist', className: 'dsh-tt-hist' },
        React.createElement('div', { key: 'h', className: 'dsh-tt-hist-head' },
          React.createElement('span', null, t.historyTitle),
          React.createElement('button', { key: 'c', className: 'dsh-tt-btn', style: { flex: 'none', fontSize: '11px', padding: '3px 8px' }, onClick: clearHistory }, t.clear)
        ),
        history.length === 0
          ? React.createElement('div', { key: 'e', className: 'dsh-tt-hist-empty' }, t.historyEmpty)
          : React.createElement('div', { key: 'l', className: 'dsh-tt-hist-list' },
            history.map((h) => React.createElement('div', { key: 'hi' + h.seq, className: 'dsh-tt-hist-item' },
              React.createElement('div', { key: 't', className: 'dsh-tt-hist-title' }, h.title || ''),
              React.createElement('div', { key: 'b', className: 'dsh-tt-hist-body' }, (h.body || '').slice(0, 80)),
              React.createElement('div', { key: 'm', className: 'dsh-tt-hist-meta' },
                React.createElement('span', null, timeAgo(h.ts)),
                h.sessionId ? React.createElement('button', { key: 'v', className: 'dsh-tt-btn', style: { flex: 'none', fontSize: '11px', padding: '2px 8px' }, onClick: () => openSession(h.sessionId) }, t.viewResult) : null,
                React.createElement('button', { key: 'r', className: 'dsh-tt-btn', style: { flex: 'none', fontSize: '11px', padding: '2px 8px' }, onClick: () => replayHist(h) }, t.replay)
              )
            ))
          )
      ) : null

      const children = [bellBtn]
      if (histPanel) children.push(histPanel)
      for (const toast of items) children.push(renderToast(toast))
      return React.createElement('div', { className: 'dsh-tt-host dsh-tt-host--' + cfg.position + themeClass }, children)
    }

    function SettingsPage() {
      const [cfg, setCfg] = React.useState(state.config)
      const t = ui(cfg.locale)
      function update(patch) {
        const next = Object.assign({}, cfg, { categories: Object.assign({}, cfg.categories) })
        if (patch.enabled !== undefined) next.enabled = patch.enabled
        if (patch.locale !== undefined) next.locale = patch.locale
        if (patch.position !== undefined) next.position = patch.position
        if (patch.viewBehavior !== undefined) next.viewBehavior = patch.viewBehavior
        if (patch.showSummary !== undefined) next.showSummary = patch.showSummary
        if (patch.onlyOtherSessions !== undefined) next.onlyOtherSessions = patch.onlyOtherSessions
        if (patch.autoDismissMs !== undefined) next.autoDismissMs = patch.autoDismissMs
        if (patch.category) next.categories[patch.category] = patch.level
        if (patch.preset) {
          const pc = applyPreset(patch.preset)
          for (const k of CATEGORY_KEYS) next.categories[k] = pc[k]
        }
        state.config = next
        setCfg(next)
        host.call('tt/config', { config: next }).catch(() => { /* ignore */ })
      }
      function selectRow(label, desc, control) {
        return React.createElement('div', { key: label, className: 'dsh-tt-row' },
          React.createElement('div', { className: 'dsh-tt-row-text' },
            React.createElement('div', { className: 'dsh-tt-row-label' }, label),
            desc ? React.createElement('div', { className: 'dsh-tt-row-desc' }, desc) : null
          ),
          control
        )
      }
      const posOpts = POSITIONS.map((p) => React.createElement('option', { key: p.id, value: p.id }, cfg.locale === 'en' ? p.en : p.zh))
      const langOpts = LOCALES.map((l) => React.createElement('option', { key: l.id, value: l.id }, cfg.locale === 'en' ? l.en : l.zh))
      const vbOpts = VIEW_BEHAVIORS.map((b) => React.createElement('option', { key: b.id, value: b.id }, cfg.locale === 'en' ? b.en : b.zh))
      const levelOpts = LEVELS.map((l) => React.createElement('option', { key: l.id, value: l.id }, cfg.locale === 'en' ? l.en : l.zh))
      const presetOpts = PRESETS.map((p) => React.createElement('option', { key: p.id, value: p.id }, cfg.locale === 'en' ? p.en : p.zh))
      return React.createElement('div', { className: 'dsh-tt-settings' },
        React.createElement('h3', { className: 'dsh-tt-section-title' }, t.settingsTitle),
        React.createElement('p', { className: 'dsh-tt-hint' }, t.settingsHint),
        React.createElement('label', { className: 'dsh-tt-check' },
          React.createElement('input', { type: 'checkbox', checked: !!cfg.enabled, onChange: (e) => update({ enabled: e.target.checked }) }), ' ' + t.enable
        ),
        selectRow(t.language, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.locale, onChange: (e) => update({ locale: e.target.value }) }, langOpts)),
        selectRow(t.position, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.position, onChange: (e) => update({ position: e.target.value }) }, posOpts)),
        selectRow(t.viewBehavior, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.viewBehavior, onChange: (e) => update({ viewBehavior: e.target.value }) }, vbOpts)),
        selectRow(t.taskLevel, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.categories.task, onChange: (e) => update({ category: 'task', level: e.target.value }) }, levelOpts)),
        selectRow(t.errorLevel, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.categories.error, onChange: (e) => update({ category: 'error', level: e.target.value }) }, levelOpts)),
        selectRow(t.preset, t.presetHint, React.createElement('select', { className: 'dsh-tt-select', value: matchPreset(cfg.categories) || '', onChange: (e) => { if (e.target.value) update({ preset: e.target.value }) } }, [React.createElement('option', { key: '', value: '' }, cfg.locale === 'en' ? '— custom —' : '— 自定义 —')].concat(presetOpts))),
        React.createElement('label', { className: 'dsh-tt-check' },
          React.createElement('input', { type: 'checkbox', checked: !!cfg.showSummary, onChange: (e) => update({ showSummary: e.target.checked }) }), ' ' + t.showSummary
        ),
        React.createElement('label', { className: 'dsh-tt-check' },
          React.createElement('input', { type: 'checkbox', checked: !!cfg.onlyOtherSessions, onChange: (e) => update({ onlyOtherSessions: e.target.checked }) }), ' ' + t.onlyOther
        ),
        selectRow(t.autoDismiss, null, React.createElement('input', { className: 'dsh-tt-input', type: 'number', min: '0', step: '1', value: String(cfg.autoDismissMs), style: { width: '90px' }, onChange: (e) => { const v = parseInt(e.target.value, 10); update({ autoDismissMs: isNaN(v) ? 0 : v }) } })),
        React.createElement('div', { className: 'dsh-tt-actions-row' },
          React.createElement('button', { className: 'dsh-tt-btn-lg', onClick: () => { host.call('tt/test', {}).catch(() => { /* ignore */ }) } }, t.testBtn)
        )
      )
    }

    if (slots) {
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'task-toast-overlay', order: 2000, label: '任务提示气泡' },
        (props) => React.createElement(React.Fragment, null,
          React.createElement(ActiveReporter, props),
          React.createElement(ToastStack, null)
        )
      ))
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'task-notifications', order: 30, label: '任务提示' },
        () => React.createElement(SettingsPage, null)
      ))
    }

    styles.insert(`
.dsh-tt-host { position: fixed; z-index: 9999; display: flex; flex-direction: column; gap: 10px; width: 340px; max-width: calc(100vw - 24px); pointer-events: none; }
.dsh-tt-host--top-left { top: 16px; left: 16px; }
.dsh-tt-host--top-right { top: 16px; right: 16px; }
.dsh-tt-host--bottom-left { bottom: 16px; left: 16px; }
.dsh-tt-host--bottom-right { bottom: 16px; right: 16px; }
.dsh-tt-toast { position: relative; pointer-events: auto; display: flex; flex-direction: column; gap: 6px; padding: 12px 56px 12px 14px; border-radius: 12px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); box-shadow: 0 8px 28px rgba(0,0,0,0.22); color: var(--dsw-alias-label-primary); animation: dsh-tt-in 0.22s ease-out; }
@keyframes dsh-tt-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.dsh-tt-toast:hover { border-color: var(--dsw-alias-border-l2); }
.dsh-tt-task { border-left: 3px solid var(--dsw-alias-state-success-primary); }
.dsh-tt-error { border-left: 3px solid var(--dsw-alias-state-error-primary); }
.dsh-tt-test { border-left: 3px solid var(--dsw-alias-brand-primary); }
.dsh-tt-title { font-weight: 600; font-size: 13px; line-height: 1.35; }
.dsh-tt-body { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-all; }
.dsh-tt-body--expanded { -webkit-line-clamp: unset; max-height: 240px; overflow: auto; white-space: pre-wrap; }
.dsh-tt-actions { display: flex; gap: 8px; margin-top: 2px; }
.dsh-tt-btn { flex: 1; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; padding: 5px 8px; font-size: 12px; cursor: pointer; }
.dsh-tt-btn:hover { border-color: var(--dsw-alias-border-l2); }
.dsh-tt-btn--primary { background: var(--dsw-alias-brand-primary); color: #fff; border-color: transparent; }
.dsh-tt-close { position: absolute; top: 6px; right: 8px; background: none; border: none; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 4px; }
.dsh-tt-close:hover { color: var(--dsw-alias-label-primary); }
.dsh-tt-settings { display: flex; flex-direction: column; gap: 12px; padding: 4px 2px; }
.dsh-tt-section-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-tt-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.dsh-tt-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.dsh-tt-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dsh-tt-row-label { font-size: 13px; color: var(--dsw-alias-label-primary); }
.dsh-tt-row-desc { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-tt-select, .dsh-tt-input { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 4px 6px; font-size: 12px; max-width: 180px; }
.dsh-tt-check { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--dsw-alias-label-primary); cursor: pointer; }
.dsh-tt-actions-row { display: flex; gap: 8px; }
.dsh-tt-btn-lg { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.dsh-tt-btn-lg:hover { border-color: var(--dsw-alias-border-l2); }
.dsh-tt-group-badge { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 8px; background: var(--dsw-alias-bg-layer-3, rgba(120,120,128,0.2)); font-size: 11px; font-weight: 600; }
.dsh-tt-bell { pointer-events: auto; align-self: flex-end; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); box-shadow: 0 4px 16px rgba(0,0,0,0.18); color: var(--dsw-alias-label-primary); cursor: pointer; position: relative; }
.dsh-tt-bell:hover { border-color: var(--dsw-alias-border-l2); }
.dsh-tt-bell-badge { position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: #FF453A; color: #fff; font-size: 10px; line-height: 16px; text-align: center; font-weight: 600; }
.dsh-tt-hist { pointer-events: auto; width: 100%; max-height: 320px; overflow: auto; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; box-shadow: 0 10px 40px rgba(0,0,0,0.18); color: var(--dsw-alias-label-primary); padding: 8px; display: flex; flex-direction: column; gap: 6px; box-sizing: border-box; }
.dsh-tt-hist-head { display: flex; align-items: center; justify-content: space-between; font-weight: 600; font-size: 13px; }
.dsh-tt-hist-empty { font-size: 12px; opacity: 0.6; padding: 8px 4px; }
.dsh-tt-hist-list { display: flex; flex-direction: column; gap: 6px; }
.dsh-tt-hist-item { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; }
.dsh-tt-hist-title { font-size: 12.5px; font-weight: 600; }
.dsh-tt-hist-body { font-size: 11.5px; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-tt-hist-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; opacity: 0.6; }
.dsh-tt-hist-meta .dsh-tt-btn { flex: none; }
`)
  },
}
