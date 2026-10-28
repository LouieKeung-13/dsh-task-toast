window.__ModuleLoader__.load({
  id: "dsh-task-toast",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    	// src/static/client.js —— 静态 client 模块源码（CommonJS factory 主体）。
	//
	// 构建：scripts/build-static.mjs 会在本文件顶部注入 src/config.js 的内联常量
	// （POSITIONS / VIEW_BEHAVIORS / LOCALES / CATEGORIES / LEVELS / *IDS /
	//  DEFAULT_CONFIG / sanitizeLevel / normalizeConfig / cloneDefaultConfig），
	// 并包装成 window.__ModuleLoader__.load({ id: 'dsh-task-toast', factory }) 的 bundle。
	//
	// 与动态版（src/client.js）的差异：
	//   · React 来自 require('react')（__ModuleLoader__ seed 词），非全局内置；
	//   · 与 Host 的通信从 harness RPC 改为同源 fetch（静态 Host 的 webServer 路由）；
	//   · 样式从 styles.insert 改为 document 注入（带 data-plugin-css 防重）。
	const React = require('react')
	
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

	/** 浮层主题：auto 跟随系统 / light 浅色 / dark 深色。 */
	const THEMES = [
	  { id: 'auto', zh: '跟随系统', en: 'System' },
	  { id: 'light', zh: '浅色', en: 'Light' },
	  { id: 'dark', zh: '深色', en: 'Dark' },
	]
	const THEME_IDS = THEMES.map((t) => t.id)

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
	    categories: cats,
	  }
	}

	/** 深拷贝一份默认配置（避免共享引用被意外改写）。 */
	function cloneDefaultConfig() {
	  return normalizeConfig(DEFAULT_CONFIG)
	}
	// ---------- HTTP API（静态 Host 的 webServer 路由，同源） ----------
	const API_BASE = '/dsh-task-toast'
	function fetchJson(path, opts) {
	  const init = Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {})
	  return fetch(API_BASE + path, init).then((r) => {
	    if (!r.ok) throw new Error('HTTP ' + r.status)
	    return r.json()
	  })
	}
	const api = {
	  state: () => fetchJson('/state'),
	  config: (config) => fetchJson('/config', { method: 'POST', body: JSON.stringify({ config: config }) }),
	  active: (sessionId) => fetchJson('/active', { method: 'POST', body: JSON.stringify({ sessionId: sessionId }) }),
	  test: () => fetchJson('/test', { method: 'POST' }),
	  poll: (since) => fetchJson('/poll?since=' + encodeURIComponent(String(since))),
	}
	
	// ---------- 多语言 UI 文案 ----------
	function ui(locale) {
	  const zh = {
	    settingsTitle: '任务提示',
	    settingsHint: '任务完成时，在所选角落弹出提示窗口，可查看结果、稍后处理或忽略。设置仅作用于本机当前安装。',
	    enable: '启用任务提示',
	    language: '界面语言',
	    theme: '主题',
	    followAccent: '跟随 dsh 皮肤主题色',
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
	    copied: '已复制',
	    copy: '复制结果',
	  }
	  const en = {
	    settingsTitle: 'Task notifications',
	    settingsHint: 'When a task finishes, a prompt appears in the chosen corner. You can view the result, snooze, or dismiss it. Settings apply to this local install only.',
	    enable: 'Enable task notifications',
	    language: 'UI language',
	    theme: 'Theme',
	    followAccent: 'Match dsh skin accent',
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
	    copied: 'Copied',
	    copy: 'Copy result',
	  }
	  return locale === 'en' ? en : zh
	}
	
	// ---------- 样式注入（防重） ----------
	function injectCss() {
	  if (typeof document === 'undefined') return
	  const tagId = 'dsh-task-toast/css'
	  if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return
	  const tag = document.createElement('style')
	  tag.dataset.plugin = 'dsh-task-toast'
	  tag.dataset.pluginCss = tagId
	  tag.textContent = `
	/* ===== Apple 风格毛玻璃（glassmorphism） ===== */
	/* 所有颜色均带显式兜底，不依赖 dsh 未定义的 CSS 变量，避免出现空白按钮 */
	.dsh-tt-host { position: fixed; z-index: 9999; display: flex; flex-direction: column; gap: 12px; width: 340px; max-width: calc(100vw - 24px); pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
	.dsh-tt-host--top-left { top: 18px; left: 18px; }
	.dsh-tt-host--top-right { top: 18px; right: 18px; }
	.dsh-tt-host--bottom-left { bottom: 18px; left: 18px; }
	.dsh-tt-host--bottom-right { bottom: 18px; right: 18px; }
	
	/* 默认（浅色玻璃） */
	.dsh-tt-toast {
	  --tt-accent: var(--dsh-tt-accent, #007AFF);
	  position: relative; pointer-events: auto;
	  display: flex; flex-direction: column; gap: 7px;
	  padding: 14px 52px 14px 16px;
	  border-radius: 18px;
	  background: rgba(255, 255, 255, 0.55);
	  -webkit-backdrop-filter: blur(22px) saturate(180%);
	  backdrop-filter: blur(22px) saturate(180%);
	  border: 1px solid rgba(255, 255, 255, 0.45);
	  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.6);
	  color: rgba(28, 28, 30, 0.92);
	  animation: dsh-tt-in 0.34s cubic-bezier(0.22, 1, 0.36, 1);
	}
	@keyframes dsh-tt-in { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: none; } }
	
	/* 深色玻璃 */
	.dsh-tt-theme-dark .dsh-tt-toast {
	  --tt-accent: var(--dsh-tt-accent, #0A84FF);
	  background: rgba(38, 38, 42, 0.55);
	  border-color: rgba(255, 255, 255, 0.12);
	  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);
	  color: rgba(245, 245, 247, 0.94);
	}
	/* 跟随系统（auto）在深色环境下自动切换为深色玻璃 */
	@media (prefers-color-scheme: dark) {
	  .dsh-tt-toast {
	    --tt-accent: var(--dsh-tt-accent, #0A84FF);
	    background: rgba(38, 38, 42, 0.55);
	    border-color: rgba(255, 255, 255, 0.12);
	    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);
	    color: rgba(245, 245, 247, 0.94);
	  }
	}
	
	/* 显式浅色（覆盖系统深色） */
	.dsh-tt-theme-light .dsh-tt-toast {
	  --tt-accent: var(--dsh-tt-accent, #007AFF);
	  background: rgba(255, 255, 255, 0.55);
	  border-color: rgba(255, 255, 255, 0.45);
	  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.6);
	  color: rgba(28, 28, 30, 0.92);
	}
	.dsh-tt-theme-light .dsh-tt-body { color: rgba(60, 60, 67, 0.7); }
	.dsh-tt-theme-light .dsh-tt-btn { background: rgba(120, 120, 128, 0.16); color: rgba(28, 28, 30, 0.9); border-color: rgba(255, 255, 255, 0.35); }
	.dsh-tt-theme-light .dsh-tt-btn:hover { background: rgba(120, 120, 128, 0.26); }
	.dsh-tt-theme-light .dsh-tt-close { background: rgba(120, 120, 128, 0.18); color: rgba(60, 60, 67, 0.7); }
	.dsh-tt-theme-light .dsh-tt-close:hover { background: rgba(120, 120, 128, 0.32); color: rgba(28, 28, 30, 0.95); }
	
	.dsh-tt-task { border-left: 3px solid #34C759; }
	.dsh-tt-error { border-left: 3px solid #FF453A; }
	.dsh-tt-test { border-left: 3px solid var(--tt-accent); }
	
	.dsh-tt-title { font-weight: 600; font-size: 13.5px; line-height: 1.35; letter-spacing: -0.01em; }
	.dsh-tt-body { font-size: 12.5px; line-height: 1.45; color: rgba(60, 60, 67, 0.7); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-all; }
	@media (prefers-color-scheme: dark) { .dsh-tt-body { color: rgba(235, 235, 245, 0.66); } }
	.dsh-tt-theme-dark .dsh-tt-body { color: rgba(235, 235, 245, 0.66); }
	.dsh-tt-body--expanded { -webkit-line-clamp: unset; max-height: 240px; overflow: auto; white-space: pre-wrap; }
	
	.dsh-tt-actions { display: flex; gap: 8px; margin-top: 3px; }
	.dsh-tt-btn { flex: 1; background: rgba(120, 120, 128, 0.16); color: rgba(28, 28, 30, 0.9); border: 1px solid rgba(255, 255, 255, 0.35); border-radius: 10px; padding: 6px 8px; font-size: 12.5px; font-weight: 500; cursor: pointer; transition: background 0.15s ease, transform 0.1s ease; }
	.dsh-tt-btn:hover { background: rgba(120, 120, 128, 0.26); }
	.dsh-tt-btn:active { transform: scale(0.97); }
	.dsh-tt-theme-dark .dsh-tt-btn { background: rgba(255, 255, 255, 0.14); color: rgba(245, 245, 247, 0.95); border-color: rgba(255, 255, 255, 0.12); }
	.dsh-tt-theme-dark .dsh-tt-btn:hover { background: rgba(255, 255, 255, 0.22); }
	@media (prefers-color-scheme: dark) { .dsh-tt-btn { background: rgba(255, 255, 255, 0.14); color: rgba(245, 245, 247, 0.95); border-color: rgba(255, 255, 255, 0.12); } .dsh-tt-btn:hover { background: rgba(255, 255, 255, 0.22); } }
	
	.dsh-tt-btn--primary { background: var(--tt-accent); color: #fff; border-color: transparent; }
	.dsh-tt-btn--primary:hover { background: var(--tt-accent); filter: brightness(1.08); }
	@media (prefers-color-scheme: dark) { .dsh-tt-btn--primary { color: #fff; } }
	
	.dsh-tt-close { position: absolute; top: 8px; right: 10px; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; background: rgba(120, 120, 128, 0.18); border: none; border-radius: 50%; color: rgba(60, 60, 67, 0.7); cursor: pointer; font-size: 13px; line-height: 1; }
	.dsh-tt-close:hover { background: rgba(120, 120, 128, 0.32); color: rgba(28, 28, 30, 0.95); }
	.dsh-tt-theme-dark .dsh-tt-close { background: rgba(255, 255, 255, 0.16); color: rgba(235, 235, 245, 0.7); }
	.dsh-tt-theme-dark .dsh-tt-close:hover { background: rgba(255, 255, 255, 0.28); color: rgba(245, 245, 247, 0.98); }
	@media (prefers-color-scheme: dark) { .dsh-tt-close { background: rgba(255, 255, 255, 0.16); color: rgba(235, 235, 245, 0.7); } }
	
	/* 设置页 */
	.dsh-tt-settings { display: flex; flex-direction: column; gap: 12px; padding: 4px 2px; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--text, rgba(28, 28, 30, 0.9)); }
	.dsh-tt-section-title { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--text, rgba(28, 28, 30, 0.92)); }
	.dsh-tt-hint { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(60, 60, 67, 0.6); }
	.dsh-tt-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 1px solid rgba(120, 120, 128, 0.22); border-radius: 10px; background: rgba(120, 120, 128, 0.08); }
	.dsh-tt-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.dsh-tt-row-label { font-size: 13px; font-weight: 500; color: var(--text, rgba(28, 28, 30, 0.92)); }
	.dsh-tt-row-desc { font-size: 11px; color: rgba(60, 60, 67, 0.55); }
	.dsh-tt-select, .dsh-tt-input { background: rgba(255, 255, 255, 0.6); color: rgba(28, 28, 30, 0.92); border: 1px solid rgba(120, 120, 128, 0.28); border-radius: 8px; padding: 4px 6px; font-size: 12px; max-width: 180px; }
	.dsh-tt-check { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text, rgba(28, 28, 30, 0.92)); cursor: pointer; }
	.dsh-tt-actions-row { display: flex; gap: 8px; }
	.dsh-tt-btn-lg { background: #007AFF; color: #fff; border: 1px solid transparent; border-radius: 8px; padding: 6px 14px; font-size: 12.5px; font-weight: 500; cursor: pointer; }
	.dsh-tt-btn-lg:hover { filter: brightness(1.06); }
	`
	  document.head.appendChild(tag)
	}
	
	// ---------- 插件主体 ----------
	const inject = ['slots', 'sessions', 'timer']
	
	const apply = async (ctx) => {
	  const state = {
	    config: Object.assign({}, DEFAULT_CONFIG, { categories: Object.assign({}, DEFAULT_CONFIG.categories) }),
	    toasts: [],
	    seq: 0,
	    toastCounter: 0,
	    activeSession: null,
	    disposed: false,
	    // 诊断：Host（Node 端）连接状态
	    hostStatus: 'connecting', // 'connecting' | 'connected' | 'error'
	    hostError: null,
	    failStreak: 0,
	    seqLocal: 0,
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
	
	  function addToast(item, lifetime) {
	    state.toastCounter += 1
	    const toast = {
	      id: item.seq,
	      ts: state.toastCounter,
	      category: item.category,
	      title: item.title,
	      body: item.body,
	      sessionId: item.sessionId,
	      expanded: false,
	      lifetime: typeof lifetime === 'number' ? lifetime : (state.config.autoDismissMs || 0),
	    }
	    state.toasts = state.toasts.concat(toast).slice(-8)
	    emitter.emit()
	    if (toast.lifetime > 0 && timer) {
	      timer.timeout(() => dismissToast(toast.id), toast.lifetime)
	    }
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
	
	  function showSystem(item) {
	    if (typeof Notification === 'undefined') return
	    try {
	      if (Notification.permission !== 'granted') return
	      const n = new Notification(item.title || 'DSH', { body: item.body || '', tag: 'dsh-tt-' + item.seq })
	      n.onclick = () => { try { if (typeof window !== 'undefined' && window.focus) window.focus() } catch (e) { /* ignore */ } openSession(item.sessionId); n.close() }
	    } catch (e) { /* ignore */ }
	  }
	
	  async function pump() {
	    while (!state.disposed) {
	      try {
	        const res = await api.poll(state.seq)
	        let items = []
	        if (res && Array.isArray(res.items)) items = res.items.filter((i) => i && typeof i.seq === 'number' && i.seq > state.seq)
	        if (res && typeof res.seq === 'number') state.seq = res.seq
	        if (items.length) handleItems(items)
	        // 连接状态诊断：成功响应即视为 Host 可达
	        if (state.hostStatus !== 'connected') {
	          state.hostStatus = 'connected'
	          state.hostError = null
	          emitter.emit() // 通知设置页刷新连接状态
	        }
	        state.failStreak = 0
	      } catch (e) {
	        state.failStreak += 1
	        state.hostError = (e && e.message) ? e.message : String(e)
	        if (state.failStreak >= 3 && state.hostStatus !== 'error') {
	          state.hostStatus = 'error'
	          emitter.emit() // 通知设置页刷新连接状态
	        }
	        console.error('[task-toast] 长轮询失败（Host 可能未加载/未重启）：', state.hostError)
	        if (timer) await timer.timeout(1500)
	      }
	    }
	  }
	
	  try {
	    const st = await api.state()
	    if (st && st.config) state.config = st.config
	  } catch (e) { console.error('task-toast state failed', e) }
	  pump()
	
	  ctx.effect(() => { return () => { state.disposed = true } })
	
	  // ---------- Toast UI（shell.overlay） ----------
	  function ActiveReporter(props) {
	    const useSessions = props && props.useSessions
	    if (typeof useSessions !== 'function') return null
	    const current = useSessions((s) => s && s.current)
	    React.useEffect(() => {
	      const next = current || null
	      if (next !== state.activeSession) {
	        state.activeSession = next
	        api.active(next).catch(() => { /* ignore */ })
	      }
	    }, [current])
	    return null
	  }
	
	  // 读取 dsh 当前皮肤的主色（若用户开启「跟随 dsh 皮肤主题色」）。
	  function readAccent() {
	    if (typeof document === 'undefined') return ''
	    try {
	      const v = getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-brand-primary')
	      return (v && v.trim()) || ''
	    } catch (e) { return '' }
	  }
	
	  function ToastStack() {
	    const [items, setItems] = React.useState([])
	    React.useEffect(() => emitter.subscribe(() => setItems(state.toasts)), [])
	    const cfg = state.config
	    const t = ui(cfg.locale)
	    const themeClass = cfg.theme === 'light' ? ' dsh-tt-theme-light' : cfg.theme === 'dark' ? ' dsh-tt-theme-dark' : ''
	    const accent = cfg.followAccent ? readAccent() : ''
	    const hostStyle = accent ? { '--dsh-tt-accent': accent } : null
	    if (!items.length) return React.createElement('div', { className: 'dsh-tt-host dsh-tt-host--' + cfg.position + themeClass, style: hostStyle })
	    const nodes = items.map((toast) => {
	      const canNavigate = cfg.viewBehavior === 'navigate' && !!toast.sessionId
	      const onView = () => {
	        if (canNavigate) { openSession(toast.sessionId); dismissToast(toast.id) }
	        else { toast.expanded = !toast.expanded; emitter.emit() }
	      }
	      const bodyClass = 'dsh-tt-body' + (toast.expanded ? ' dsh-tt-body--expanded' : '')
	      const children = [
	        React.createElement('div', { key: 'title', className: 'dsh-tt-title' }, toast.title || ''),
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
	        title: toast.sessionId ? t.viewResult + ' · ' + toast.sessionId : '',
	      }, children)
	    })
	    return React.createElement('div', { className: 'dsh-tt-host dsh-tt-host--' + cfg.position + themeClass, style: hostStyle }, nodes)
	  }
	
	  // ---------- 设置页（settings.section） ----------
	  function SettingsPage() {
	    const [cfg, setCfg] = React.useState(state.config)
	    const [, forceTick] = React.useState(0)
	    const t = ui(cfg.locale)
	    React.useEffect(() => {
	      try { if (typeof Notification !== 'undefined' && Notification.permission) {} } catch (e) { /* ignore */ }
	      // 订阅 emitter，使 Host 连接状态等诊断信息实时刷新
	      const off = emitter.subscribe(() => forceTick((n) => n + 1))
	      return off
	    }, [])
	
	    function update(patch) {
	      const next = Object.assign({}, cfg, {
	        categories: Object.assign({}, cfg.categories),
	      })
	      if (patch.enabled !== undefined) next.enabled = patch.enabled
	      if (patch.locale !== undefined) next.locale = patch.locale
	      if (patch.theme !== undefined) next.theme = patch.theme
	      if (patch.followAccent !== undefined) next.followAccent = patch.followAccent
	      if (patch.position !== undefined) next.position = patch.position
	      if (patch.viewBehavior !== undefined) next.viewBehavior = patch.viewBehavior
	      if (patch.showSummary !== undefined) next.showSummary = patch.showSummary
	      if (patch.onlyOtherSessions !== undefined) next.onlyOtherSessions = patch.onlyOtherSessions
	      if (patch.autoDismissMs !== undefined) next.autoDismissMs = patch.autoDismissMs
	      if (patch.category) next.categories[patch.category] = patch.level
	      state.config = next
	      setCfg(next)
	      api.config(next).catch(() => { /* ignore */ })
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
	    const themeOpts = THEMES.map((tm) => React.createElement('option', { key: tm.id, value: tm.id }, cfg.locale === 'en' ? tm.en : tm.zh))
	    const vbOpts = VIEW_BEHAVIORS.map((b) => React.createElement('option', { key: b.id, value: b.id }, cfg.locale === 'en' ? b.en : b.zh))
	    const levelOpts = LEVELS.map((l) => React.createElement('option', { key: l.id, value: l.id }, cfg.locale === 'en' ? l.en : l.zh))
	
	    // 连接状态文案（诊断用）
	    const statusText =
	      state.hostStatus === 'connected' ? (cfg.locale === 'en' ? 'Host connected' : 'Host 已连接')
	        : state.hostStatus === 'error' ? (cfg.locale === 'en' ? 'Host unreachable' : 'Host 未连接')
	          : (cfg.locale === 'en' ? 'Connecting…' : '连接中…')
	    const statusColor =
	      state.hostStatus === 'connected' ? 'var(--dsw-alias-state-success-primary)'
	        : state.hostStatus === 'error' ? 'var(--dsw-alias-state-error-primary)'
	          : 'var(--dsw-alias-label-secondary)'
	
	    // 测试通知：先尝试 Host 真实链路；若 Host 不可达，则本地兜底弹窗并提示原因。
	    function sendTest() {
	      api.test().catch((err) => {
	        const msg = (err && err.message) ? err.message : String(err)
	        state.hostError = msg
	        state.hostStatus = 'error'
	        state.seqLocal -= 1
	        addToast({
	          seq: state.seqLocal,
	          category: 'test',
	          sessionId: null,
	          title: (cfg.locale === 'en' ? 'Test (local fallback)' : '测试通知（本地预览）'),
	          body: (cfg.locale === 'en'
	            ? 'Host process did not respond: ' + msg + '. This preview proves the overlay UI works.'
	            : '宿主进程（Host）未响应：' + msg + '。此本地预览证明浮层 UI 本身可用，请检查 dsh 是否重启 / Host 是否挂载。'),
	        }, 12000)
	        emitter.emit()
	      })
	    }
	
	    return React.createElement('div', { className: 'dsh-tt-settings' },
	      React.createElement('h3', { className: 'dsh-tt-section-title' }, t.settingsTitle),
	      React.createElement('p', { className: 'dsh-tt-hint' }, t.settingsHint),
	      React.createElement('div', { className: 'dsh-tt-row' },
	        React.createElement('div', { className: 'dsh-tt-row-text' },
	          React.createElement('div', { className: 'dsh-tt-row-label' }, cfg.locale === 'en' ? 'Host status' : 'Host 连接状态'),
	          React.createElement('div', { className: 'dsh-tt-row-desc' },
	            state.hostStatus === 'error' && state.hostError ? state.hostError.slice(0, 80) : (cfg.locale === 'en' ? 'Whether the Node host serves HTTP routes' : '宿主进程是否提供了 HTTP 路由'))
	        ),
	        React.createElement('span', { style: { color: statusColor, fontWeight: 600 } }, statusText)
	      ),
	      React.createElement('label', { className: 'dsh-tt-check' },
	        React.createElement('input', { type: 'checkbox', checked: !!cfg.enabled, onChange: (e) => update({ enabled: e.target.checked }) }),
	        ' ' + t.enable
	      ),
	      selectRow(t.language, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.locale, onChange: (e) => update({ locale: e.target.value }) }, langOpts)),
	      selectRow(t.theme, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.theme, onChange: (e) => update({ theme: e.target.value }) }, themeOpts)),
	      React.createElement('label', { className: 'dsh-tt-check' },
	        React.createElement('input', { type: 'checkbox', checked: !!cfg.followAccent, onChange: (e) => update({ followAccent: e.target.checked }) }),
	        ' ' + t.followAccent
	      ),
	      selectRow(t.position, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.position, onChange: (e) => update({ position: e.target.value }) }, posOpts)),
	      selectRow(t.viewBehavior, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.viewBehavior, onChange: (e) => update({ viewBehavior: e.target.value }) }, vbOpts)),
	      selectRow(t.taskLevel, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.categories.task, onChange: (e) => update({ category: 'task', level: e.target.value }) }, levelOpts)),
	      selectRow(t.errorLevel, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.categories.error, onChange: (e) => update({ category: 'error', level: e.target.value }) }, levelOpts)),
	      React.createElement('label', { className: 'dsh-tt-check' },
	        React.createElement('input', { type: 'checkbox', checked: !!cfg.showSummary, onChange: (e) => update({ showSummary: e.target.checked }) }),
	        ' ' + t.showSummary
	      ),
	      React.createElement('label', { className: 'dsh-tt-check' },
	        React.createElement('input', { type: 'checkbox', checked: !!cfg.onlyOtherSessions, onChange: (e) => update({ onlyOtherSessions: e.target.checked }) }),
	        ' ' + t.onlyOther
	      ),
	      selectRow(t.autoDismiss, null, React.createElement('input', { className: 'dsh-tt-input', type: 'number', min: '0', step: '1', value: String(cfg.autoDismissMs), style: { width: '90px' }, onChange: (e) => { const v = parseInt(e.target.value, 10); update({ autoDismissMs: isNaN(v) ? 0 : v }) } })),
	      React.createElement('div', { className: 'dsh-tt-actions-row' },
	        React.createElement('button', { className: 'dsh-tt-btn-lg', onClick: () => { sendTest() } }, t.testBtn)
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
	
	  injectCss()
	}
	
	module.exports = { apply, inject }
    return module.exports;
  }
});
