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

	/** 插件版本（与 package.json 保持同步；Host 侧会优先读真实 package.json）。 */
	const VERSION = '1.7.0'

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
	    durationMs: 12000,      // 卡片自动消失 / 置顶保持时长（ms），0 = 跟随浮层自动消失时长
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
	  version: () => fetchJson('/version'),
	  checkUpdate: () => fetchJson('/check-update', { method: 'POST' }),
	  update: (payload) => fetchJson('/update', { method: 'POST', body: JSON.stringify(payload || {}) }),
	  topmost: (action) => fetchJson('/topmost', { method: 'POST', body: JSON.stringify({ action: action }) }),
	  card: (action) => fetchJson('/card', { method: 'POST', body: JSON.stringify({ action: action }) }),
	}
	
	// 本地兜底用的更新命令（Host 不可达时「复制更新命令」仍可用）。
	const LOCAL_UPDATE_CMD = 'dsh plugin --profile web remove dsh-task-toast\ndsh plugin --profile web add github:' + REPO
	
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
	    // 与应用内浮层的「自动消失」区分：本项只管应用内浮层，两者互不影响
	    autoDismiss: '应用内浮层自动消失（秒，0 = 不自动关闭）',
	    autoDismissHint: '只作用于 dsh 窗口里的浮层气泡，与「卡片停留」互不冲突；卡片弹出成功时应用内不再重复弹。',
	    taskLevel: '任务完成',
	    errorLevel: '错误失败',
	    updateLevel: '插件更新提醒',
	    levelOff: '关闭',
	    levelApp: '应用内提示',
	    levelSystem: '系统通知',
	    testBtn: '发送测试通知',
	    viewResult: '查看结果',
	    later: '稍后',
	    dismiss: '忽略',
	    copied: '已复制',
	    copy: '复制结果',
	    // ---- 更新提醒 ----
	    versionSection: '版本与更新',
	    currentVersion: '当前版本',
	    latestVersion: '最新版本',
	    statusLatest: '已是最新版本',
	    statusNew: '发现新版本',
	    statusUnknown: '尚未检查',
	    statusChecking: '检查中…',
	    autoCheck: '自动检查更新（启动时 + 每 6 小时）',
	    checkNow: '立即检查',
	    checking: '检查中…',
	    copyCmd: '复制更新命令',
	    updateNow: '一键更新',
	    updating: '更新中…',
	    cmdCopied: '更新命令已复制，请在终端执行后重启 dsh',
	    updateDone: '更新命令已执行成功，请重启 dsh 生效',
	    updateFailed: '自动更新失败，请复制命令在终端手动执行',
	    releasePage: '发布页',
	    updateBtn: '更新',
	    hostNeeded: '更新功能需要 Host 已连接（若未连接请彻底重启 dsh）',
	    // ---- 置顶 / 独立卡片 ----
	    topmost: '通知呈现方式',
	    modeCard: '独立置顶小卡片',
	    modeWindow: '提升 dsh 窗口',
	    modeOff: '关闭（仅应用内）',
	    topmostHint: '「独立小卡片」会创建一个脱离 dsh 的无边框浮窗，只占屏幕一角、压在所有应用之上、不抢焦点；「提升 dsh 窗口」则把整个 dsh 窗口顶到最前面。仅 Windows 桌面客户端支持。',
	    topmostDuration: '卡片停留（秒，0 = 跟随浮层）',
	    topmostDurationHint: '只作用于独立卡片 / 窗口置顶的时长，与「应用内浮层自动消失」是两条独立计时，不冲突。鼠标停在卡片上时会暂停倒计时。',
	    alsoToast: '同时发送 Windows 系统通知（通知中心留痕）',
	    alsoToastHint: '开启后，卡片弹出的同时也会发一条 Windows 原生通知：横幅直接浮在所有窗口之上，并沉淀到系统通知中心；卡片万一没起来，它也是兜底通道。',
	    topmostTest: '测试置顶',
	    topmostOk: '已置顶，3 秒后自动恢复',
	    topmostFail: '置顶未生效（非桌面客户端，或未找到 dsh 窗口）',
	    topmostCancel: '已取消置顶',
	    cardTest: '测试卡片',
	    cardOk: '卡片已弹出，请看屏幕角落',
	    cardFail: '卡片未能弹出',
	    cardUnsupported: '当前环境不支持独立卡片（仅 Windows 桌面客户端）',
	    cardSelfTest: '卡片自检',
	    cardSelfOk: '通过（可正常弹出）',
	    // ---- 更新（新增：强制重装） ----
	    forceReinstall: '强制重装（忽略版本）',
	    forceReinstalling: '重装中…',
	    reinstallHint: '已是最新版时也可用它把插件文件整包重刷一遍（修损坏安装）；完成后需重启 dsh。',
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
	    // 与应用内浮层的「自动消失」区分：本项只管应用内浮层，两者互不影响
	    autoDismiss: 'In-app overlay auto-dismiss (seconds, 0 = never)',
	    autoDismissHint: 'Applies only to the in-app bubble; independent of “Card lifetime”. When the card shows successfully, no in-app bubble is rendered.',
	    taskLevel: 'Task completed',
	    errorLevel: 'Error',
	    updateLevel: 'Plugin update alerts',
	    levelOff: 'Off',
	    levelApp: 'In-app toast',
	    levelSystem: 'System notification',
	    testBtn: 'Send test notification',
	    viewResult: 'View result',
	    later: 'Later',
	    dismiss: 'Dismiss',
	    copied: 'Copied',
	    copy: 'Copy result',
	    // ---- Update ----
	    versionSection: 'Version & updates',
	    currentVersion: 'Installed',
	    latestVersion: 'Latest',
	    statusLatest: 'Up to date',
	    statusNew: 'Update available',
	    statusUnknown: 'Not checked yet',
	    statusChecking: 'Checking…',
	    autoCheck: 'Check automatically (on start + every 6 h)',
	    checkNow: 'Check now',
	    checking: 'Checking…',
	    copyCmd: 'Copy update command',
	    updateNow: 'One-click update',
	    updating: 'Updating…',
	    cmdCopied: 'Command copied. Run it in a terminal, then restart dsh',
	    updateDone: 'Update finished. Restart dsh to apply',
	    updateFailed: 'Auto-update failed — copy the command and run it manually',
	    releasePage: 'Release page',
	    updateBtn: 'Update',
	    hostNeeded: 'Update requires the Host process (restart dsh if it is not connected)',
	    // ---- Topmost / standalone card ----
	    topmost: 'Notification surface',
	    modeCard: 'Standalone floating card',
	    modeWindow: 'Raise the dsh window',
	    modeOff: 'Off (in-app only)',
	    topmostHint: '“Standalone card” creates a borderless window detached from dsh — one corner of the screen, above every app, without stealing focus. “Raise the dsh window” brings the whole dsh window to the front instead. Windows desktop client only.',
	    topmostDuration: 'Card lifetime (seconds, 0 = follow overlay)',
	    topmostDurationHint: 'Only controls the standalone card / topmost window. It is a separate timer from “auto-dismiss” — no conflict. The countdown pauses while the cursor rests on the card.',
	    alsoToast: 'Also send a Windows notification (kept in Action Center)',
	    alsoToastHint: 'When on, a native Windows notification fires alongside the card: the banner floats above every window and is kept in the Action Center. If the card ever fails to appear, this is the fallback channel.',
	    topmostTest: 'Test topmost',
	    topmostOk: 'Raised on top — restores in 3s',
	    topmostFail: 'Topmost did not apply (not the desktop client, or window not found)',
	    topmostCancel: 'Topmost released',
	    cardTest: 'Test card',
	    cardOk: 'Card shown — check the screen corner',
	    cardFail: 'Card could not be shown',
	    cardUnsupported: 'Standalone card is unavailable here (Windows desktop client only)',
	    cardSelfTest: 'Card self-test',
	    cardSelfOk: 'passed (card can be shown)',
	    // ---- Update (force reinstall) ----
	    forceReinstall: 'Force reinstall (ignore version)',
	    forceReinstalling: 'Reinstalling…',
	    reinstallHint: 'Even when already up to date, this re-writes every plugin file (repairs a broken install). Restart dsh afterwards.',
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
	  background: rgba(38, 38, 42, 0.55);
	  border-color: rgba(255, 255, 255, 0.12);
	  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);
	  color: rgba(245, 245, 247, 0.94);
	}
	/* 跟随系统（auto）在深色环境下自动切换为深色玻璃 */
	@media (prefers-color-scheme: dark) {
	  .dsh-tt-toast {
	    background: rgba(38, 38, 42, 0.55);
	    border-color: rgba(255, 255, 255, 0.12);
	    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);
	    color: rgba(245, 245, 247, 0.94);
	  }
	}
	
	/* 显式浅色（覆盖系统深色） */
	.dsh-tt-theme-light .dsh-tt-toast {
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
	
	/* 分类色竖条已按反馈移除：整卡统一为单色系，不再用彩色区分类型 */
	
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
	
	/* 主按钮 = 单色：浅色环境近黑、深色环境近白（不再跟随强调色） */
	.dsh-tt-btn--primary { background: #1c1c1e; color: #fff; border-color: transparent; }
	.dsh-tt-btn--primary:hover { filter: brightness(1.3); }
	@media (prefers-color-scheme: dark) { .dsh-tt-btn--primary { background: rgba(245, 245, 247, 0.92); color: #1c1c1e; } .dsh-tt-btn--primary:hover { filter: brightness(0.92); } }
	
	.dsh-tt-close { position: absolute; top: 8px; right: 10px; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; background: rgba(120, 120, 128, 0.18); border: none; border-radius: 50%; color: rgba(60, 60, 67, 0.7); cursor: pointer; font-size: 13px; line-height: 1; }
	.dsh-tt-close:hover { background: rgba(120, 120, 128, 0.32); color: rgba(28, 28, 30, 0.95); }
	.dsh-tt-theme-dark .dsh-tt-close { background: rgba(255, 255, 255, 0.16); color: rgba(235, 235, 245, 0.7); }
	.dsh-tt-theme-dark .dsh-tt-close:hover { background: rgba(255, 255, 255, 0.28); color: rgba(245, 245, 247, 0.98); }
	@media (prefers-color-scheme: dark) { .dsh-tt-close { background: rgba(255, 255, 255, 0.16); color: rgba(235, 235, 245, 0.7); } }
	
	/* 设置页 —— 全部改用 dsh 设计令牌，让本插件的面板与 dsh 自带的其它设置项完全同色同风格 */
	.dsh-tt-settings {
	  --tt-surface: var(--dsw-alias-bg-secondary, rgba(120,120,128,0.08));
	  --tt-control: var(--dsw-alias-bg-tertiary, rgba(120,120,128,0.16));
	  --tt-border: var(--dsw-alias-border-secondary, rgba(120,120,128,0.22));
	  --tt-fg: var(--dsw-alias-label-primary, rgba(28,28,30,0.92));
	  --tt-fg-dim: var(--dsw-alias-label-secondary, rgba(60,60,67,0.6));
	  display: flex; flex-direction: column; gap: 12px; padding: 4px 2px;
	  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", "Microsoft YaHei", sans-serif;
	  color: var(--tt-fg);
	}
	@media (prefers-color-scheme: dark) {
	  .dsh-tt-settings {
	    --tt-surface: var(--dsw-alias-bg-secondary, rgba(255,255,255,0.06));
	    --tt-control: var(--dsw-alias-bg-tertiary, rgba(255,255,255,0.12));
	    --tt-border: var(--dsw-alias-border-secondary, rgba(255,255,255,0.14));
	    --tt-fg: var(--dsw-alias-label-primary, rgba(245,245,247,0.94));
	    --tt-fg-dim: var(--dsw-alias-label-secondary, rgba(235,235,245,0.62));
	  }
	}
	.dsh-tt-section-title { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--tt-fg); }
	.dsh-tt-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--tt-fg-dim); }
	.dsh-tt-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 1px solid var(--tt-border); border-radius: 10px; background: var(--tt-surface); }
	.dsh-tt-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.dsh-tt-row-label { font-size: 13px; font-weight: 500; color: var(--tt-fg); }
	.dsh-tt-row-desc { font-size: 11px; color: var(--tt-fg-dim); }
	/* 面板控件与行同一套令牌：下拉框 / 输入框 / 行底色同族，不再出现第三种灰 */
	.dsh-tt-settings .dsh-tt-select, .dsh-tt-settings .dsh-tt-input {
	  background: var(--tt-control) !important; color: var(--tt-fg) !important;
	  border: 1px solid var(--tt-border); border-radius: 8px; padding: 4px 8px; font-size: 12px; max-width: 180px;
	}
	.dsh-tt-settings .dsh-tt-select option { background: var(--tt-surface); color: var(--tt-fg); }
	.dsh-tt-check { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--tt-fg); cursor: pointer; }
	.dsh-tt-actions-row { display: flex; gap: 8px; flex-wrap: wrap; }
	/* 面板按钮 = 单色（与浮层主按钮同一套，不跟随强调色） */
	.dsh-tt-btn-lg { background: var(--dsw-alias-label-primary, #1c1c1e); color: var(--dsw-alias-bg-primary, #fff); border: 1px solid transparent; border-radius: 8px; padding: 6px 14px; font-size: 12.5px; font-weight: 500; cursor: pointer; }
	.dsh-tt-btn-lg:hover { filter: brightness(1.25); }
	.dsh-tt-btn-lg--ghost { background: var(--tt-control); color: var(--tt-fg); border-color: var(--tt-border); }
	.dsh-tt-btn-lg:disabled { opacity: 0.5; cursor: default; filter: none; }
	.dsh-tt-log { margin: 0; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-all; padding: 8px 10px; border-radius: 8px; background: var(--tt-surface); border: 1px solid var(--tt-border); color: var(--tt-fg); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 1.5; }
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
	    // 更新检查缓存（由 /version 拉取，Host 不可达时回落本地常量）
	    updateInfo: null,
	    updateCmd: LOCAL_UPDATE_CMD,
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
	    // 所有浮层都关掉后，立即把 dsh 窗口层级还原（不必等置顶定时器到期）
	    if (!state.toasts.length) api.topmost('restore').catch(() => { /* ignore */ })
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
	
	  /** 轻量反馈提示（用于「已复制更新命令」等一次性回执）。 */
	  function flash(title, body) {
	    state.seqLocal -= 1
	    addToast({ seq: state.seqLocal, category: 'update', sessionId: null, title: title, body: body || '' }, 8000)
	  }
	
	  /** 复制更新命令到剪贴板，并弹一条回执。 */
	  function copyUpdateCmd(cfg) {
	    const t = ui((cfg && cfg.locale) || state.config.locale)
	    try {
	      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
	        navigator.clipboard.writeText(state.updateCmd || LOCAL_UPDATE_CMD)
	      }
	    } catch (e) { /* ignore */ }
	    flash(t.cmdCopied, state.updateCmd || LOCAL_UPDATE_CMD)
	  }
	
	  function handleItems(items) {
	    for (const item of items) {
	      if (!item) continue
	      // 独立卡片上的「查看结果」→ 直接跳到对应会话
	      if (item.kind === 'card-view') {
	        if (item.sessionId) openSession(item.sessionId)
	        continue
	      }
	      // 已经由独立卡片呈现过的通知，页面内不再重复渲染（避免一次事件两个通知）
	      if (item.silent) continue
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
	  try {
	    const v = await api.version()
	    if (v) {
	      state.updateInfo = v
	      if (typeof v.updateCmd === 'string' && v.updateCmd) state.updateCmd = v.updateCmd
	    }
	  } catch (e) { /* Host 不可达时保持本地兜底命令 */ }
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
	
	    // 把解析到的 dsh 皮肤主色回传给 Host，让独立卡片用同一个强调色
	    React.useEffect(() => {
	      if (!cfg.followAccent) return
	      const m = /^#?([0-9a-fA-F]{6})$/.exec(String(accent || '').trim())
	      if (!m) return
	      const hex = '#' + m[1].toUpperCase()
	      if (String(state.config.accent || '').toUpperCase() === hex) return
	      state.config = Object.assign({}, state.config, { accent: hex })
	      api.config(state.config).catch(() => { /* ignore */ })
	    }, [accent, cfg.followAccent])
	    if (!items.length) return React.createElement('div', { className: 'dsh-tt-host dsh-tt-host--' + cfg.position + themeClass, style: hostStyle })
	    const nodes = items.map((toast) => {
	      const isUpdate = toast.category === 'update'
	      const canNavigate = cfg.viewBehavior === 'navigate' && !!toast.sessionId && !isUpdate
	      const onView = () => {
	        if (isUpdate) { copyUpdateCmd(cfg); dismissToast(toast.id); return }
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
	          React.createElement('button', { key: 'view', className: 'dsh-tt-btn dsh-tt-btn--primary', onClick: onView }, isUpdate ? t.updateBtn : t.viewResult),
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
	      // 保留页面回传的强调色（由 ToastStack 依据 dsh 皮肤写入 state.config）
	      if (!next.accent && state.config.accent) next.accent = state.config.accent
	      if (patch.enabled !== undefined) next.enabled = patch.enabled
	      if (patch.locale !== undefined) next.locale = patch.locale
	      if (patch.theme !== undefined) next.theme = patch.theme
	      if (patch.followAccent !== undefined) next.followAccent = patch.followAccent
	      if (patch.position !== undefined) next.position = patch.position
	      if (patch.viewBehavior !== undefined) next.viewBehavior = patch.viewBehavior
	      if (patch.showSummary !== undefined) next.showSummary = patch.showSummary
	      if (patch.onlyOtherSessions !== undefined) next.onlyOtherSessions = patch.onlyOtherSessions
	      if (patch.autoDismissMs !== undefined) next.autoDismissMs = patch.autoDismissMs
	      if (patch.checkUpdate !== undefined) next.checkUpdate = patch.checkUpdate
	      if (patch.topmost) next.topmost = Object.assign({}, cfg.topmost, patch.topmost)
	      if (patch.category) next.categories[patch.category] = patch.level
	      state.config = next
	      setCfg(next)
	      api.config(next).catch(() => { /* ignore */ })
	    }
	
	    // ---------- 版本与更新 ----------
	    const [upd, setUpd] = React.useState(state.updateInfo)
	    const [updChecking, setUpdChecking] = React.useState(false)
	    const [updRunning, setUpdRunning] = React.useState(false)
	    const [updLog, setUpdLog] = React.useState('')
	    const [topmostMsg, setTopmostMsg] = React.useState('')
	
	    function doTopmostProbe() {
	      const mode = (cfg.topmost && cfg.topmost.mode) || 'card'
	      const fmtErr = (r, err) => {
	        const parts = []
	        if (r && r.error) parts.push(r.error)
	        if (r && r.stderr) parts.push(String(r.stderr).replace(/\s+/g, ' ').slice(0, 120))
	        if (!parts.length && err) parts.push((err && err.message) || String(err))
	        return parts.join(' · ')
	      }
	      if (mode === 'card') {
	        setTopmostMsg(cfg.locale === 'en' ? 'Showing card…' : '正在弹出卡片…')
	        api.card('probe').then((r) => {
	          if (r && r.ok) setTopmostMsg(t.cardOk)
	          else setTopmostMsg(t.cardFail + (fmtErr(r) ? '：' + fmtErr(r) : ''))
	        }).catch((err) => {
	          setTopmostMsg(t.cardFail + '：' + ((err && err.message) || String(err)))
	        })
	        return
	      }
	      setTopmostMsg(cfg.locale === 'en' ? 'Raising…' : '正在置顶…')
	      api.topmost('probe').then((r) => {
	        const ok = r && r.ok && (r.windows || 0) > 0
	        setTopmostMsg(ok ? t.topmostOk : t.topmostFail + (r && r.error ? ' · ' + r.error : ''))
	      }).catch((err) => {
	        setTopmostMsg(t.topmostFail + ' · ' + ((err && err.message) || String(err)))
	      })
	    }
	
	    React.useEffect(() => {
	      if (state.updateInfo) { setUpd(state.updateInfo); return }
	      api.version().then((v) => {
	        state.updateInfo = v
	        if (typeof v.updateCmd === 'string' && v.updateCmd) state.updateCmd = v.updateCmd
	        setUpd(v)
	      }).catch(() => { /* 保持 null，显示「尚未检查」 */ })
	    }, [])
	
	    function doCheck() {
	      setUpdChecking(true)
	      setUpdLog('')
	      api.checkUpdate().then((v) => {
	        state.updateInfo = v
	        setUpd(v)
	      }).catch((err) => {
	        setUpd({ local: VERSION, latest: null, hasUpdate: false, error: (err && err.message) || String(err), checkedAt: Date.now() })
	      }).then(() => setUpdChecking(false))
	    }
	
	    function doCopyCmd() {
	      try {
	        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
	          navigator.clipboard.writeText(state.updateCmd || LOCAL_UPDATE_CMD)
	        }
	      } catch (e) { /* ignore */ }
	      setUpdLog((cfg.locale === 'en' ? 'Command copied:\n' : '已复制更新命令：\n') + (state.updateCmd || LOCAL_UPDATE_CMD) + (cfg.locale === 'en' ? '\n\nRun it in a terminal, then restart dsh.' : '\n\n请在终端执行后重启 dsh。'))
	    }
	
	    function doUpdate(force) {
	      setUpdRunning(true)
	      setUpdLog(force
	        ? (cfg.locale === 'en' ? 'Reinstalling plugin files from master …' : '正在从 master 重新拉取插件文件 …')
	        : (cfg.locale === 'en' ? 'Running one-click update … (may take a minute)' : '正在执行一键更新 …（可能需要一分钟）'))
	      api.update({ force: !!force }).then((r) => {
	        const en = cfg.locale === 'en'
	        const modeNote = r && r.mode === 'self'
	          ? (en ? ' (files replaced' + (r.version ? ' → v' + r.version : '') + ')' : '（已替换插件文件' + (r.version ? ' → v' + r.version : '') + '）')
	          : (r && r.mode === 'cli' ? (en ? ' (via dsh plugin)' : '（已执行 dsh plugin）') : '')
	        const head = r && r.ok
	          ? (en ? '✅ Updated' + modeNote + '. Restart dsh to apply.\n\n' : '✅ 更新完成' + modeNote + '，请重启 dsh 生效。\n\n')
	          : (en ? '⚠️ Auto-update failed. Please copy the command and run it manually.\n\n' : '⚠️ 自动更新失败，请复制命令在终端手动执行。\n\n')
	        setUpdLog(head + ((r && r.log) || ''))
	        if (r && r.ok && r.version) {
	          // 立刻把版本号刷新到 UI，避免更新后仍显示旧版本 / 仍提示有新版本
	          setUpd(Object.assign({}, upd, { local: r.version, latest: r.version, hasUpdate: false, checkedAt: Date.now() }))
	          state.updateInfo = Object.assign({}, state.updateInfo, { local: r.version, latest: r.version, hasUpdate: false })
	        }
	      }).catch((err) => {
	        setUpdLog((cfg.locale === 'en' ? '⚠️ Update request failed: ' : '⚠️ 更新请求失败：') + ((err && err.message) || String(err)) + '\n\n' + (cfg.locale === 'en' ? 'Fallback command:\n' : '可手动执行：\n') + (state.updateCmd || LOCAL_UPDATE_CMD))
	      }).then(() => setUpdRunning(false))
	    }
	
	    const updStatusText =
	      !upd ? t.statusUnknown
	        : upd.checking || updChecking ? t.statusChecking
	          : upd.error ? (cfg.locale === 'en' ? 'Check failed' : '检查失败')
	            : upd.hasUpdate ? t.statusNew + ' · ' + upd.latest
	              : t.statusLatest
	    const updStatusColor = !upd ? 'rgba(60,60,67,0.55)'
	      : upd.checking || updChecking ? 'rgba(60,60,67,0.55)'
	        : upd.error ? '#FF9F0A'
	          : upd.hasUpdate ? '#007AFF' : '#34C759'
	
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
	
	      // ---------- 通知呈现方式：独立卡片 / 抬 dsh 窗口 / 关闭 ----------
	      selectRow(t.topmost, null, React.createElement('select', {
	        className: 'dsh-tt-select',
	        value: (cfg.topmost && cfg.topmost.mode) || 'card',
	        onChange: (e) => update({ topmost: { mode: e.target.value } }),
	      }, TOPMOST_MODES.map((m) => React.createElement('option', { key: m.id, value: m.id }, cfg.locale === 'en' ? m.en : m.zh)))),
	      React.createElement('p', { className: 'dsh-tt-hint' }, t.topmostHint),
	      ((cfg.topmost && cfg.topmost.mode) || 'card') !== 'off'
	        ? selectRow(t.topmostDuration, null, React.createElement('input', {
	          className: 'dsh-tt-input', type: 'number', min: '3', max: '120', step: '1', style: { width: '90px' },
	          value: String(Math.round((((cfg.topmost || {}).durationMs) || 0) / 1000)),
	          onChange: (e) => { const v = parseInt(e.target.value, 10); update({ topmost: { durationMs: (isNaN(v) ? 0 : v) * 1000 } }) },
	        }))
	        : null,
	      ((cfg.topmost && cfg.topmost.mode) || 'card') !== 'off'
	        ? React.createElement(React.Fragment, null,
	          React.createElement('p', { className: 'dsh-tt-hint' }, t.topmostDurationHint),
	          React.createElement('label', { className: 'dsh-tt-check' },
	            React.createElement('input', {
	              type: 'checkbox',
	              checked: !!(cfg.topmost || {}).alsoSystemToast,
	              onChange: (e) => update({ topmost: { alsoSystemToast: e.target.checked } }),
	            }),
	            ' ' + t.alsoToast
	          ),
	          React.createElement('p', { className: 'dsh-tt-hint' }, t.alsoToastHint)
	        )
	        : null,
	
	      selectRow(t.viewBehavior, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.viewBehavior, onChange: (e) => update({ viewBehavior: e.target.value }) }, vbOpts)),
	      selectRow(t.taskLevel, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.categories.task, onChange: (e) => update({ category: 'task', level: e.target.value }) }, levelOpts)),
	      selectRow(t.errorLevel, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.categories.error, onChange: (e) => update({ category: 'error', level: e.target.value }) }, levelOpts)),
	      selectRow(t.updateLevel, null, React.createElement('select', { className: 'dsh-tt-select', value: cfg.categories.update, onChange: (e) => update({ category: 'update', level: e.target.value }) }, levelOpts)),
	      React.createElement('label', { className: 'dsh-tt-check' },
	        React.createElement('input', { type: 'checkbox', checked: !!cfg.showSummary, onChange: (e) => update({ showSummary: e.target.checked }) }),
	        ' ' + t.showSummary
	      ),
	      React.createElement('label', { className: 'dsh-tt-check' },
	        React.createElement('input', { type: 'checkbox', checked: !!cfg.onlyOtherSessions, onChange: (e) => update({ onlyOtherSessions: e.target.checked }) }),
	        ' ' + t.onlyOther
	      ),
	      selectRow(t.autoDismiss, null, React.createElement('input', { className: 'dsh-tt-input', type: 'number', min: '0', step: '1', value: String(cfg.autoDismissMs), style: { width: '90px' }, onChange: (e) => { const v = parseInt(e.target.value, 10); update({ autoDismissMs: isNaN(v) ? 0 : v }) } })),
	      React.createElement('p', { className: 'dsh-tt-hint' }, t.autoDismissHint),
	      React.createElement('div', { className: 'dsh-tt-actions-row' },
	        React.createElement('button', { className: 'dsh-tt-btn-lg', onClick: () => { sendTest() } }, t.testBtn),
	        React.createElement('button', { className: 'dsh-tt-btn-lg dsh-tt-btn-lg--ghost', onClick: () => doTopmostProbe() },
	          ((cfg.topmost && cfg.topmost.mode) || 'card') === 'card' ? t.cardTest : t.topmostTest)
	      ),
	      topmostMsg ? React.createElement('p', { className: 'dsh-tt-hint' }, topmostMsg) : null,
	      (((cfg.topmost && cfg.topmost.mode) || 'card') === 'card' && upd && upd.cardSelfTest && upd.cardSelfTest !== 'pending')
	        ? React.createElement('p', { className: 'dsh-tt-hint' },
	          t.cardSelfTest + ' · ' + (upd.cardSelfTest === 'ok' ? t.cardSelfOk : String(upd.cardSelfTest).slice(0, 120)))
	        : null,
	
	      // ---------- 版本与更新 ----------
	      React.createElement('h3', { className: 'dsh-tt-section-title', style: { marginTop: '6px' } }, t.versionSection),
	      React.createElement('div', { className: 'dsh-tt-row' },
	        React.createElement('div', { className: 'dsh-tt-row-text' },
	          React.createElement('div', { className: 'dsh-tt-row-label' }, t.currentVersion + ' v' + ((upd && upd.local) || VERSION)),
	          React.createElement('div', { className: 'dsh-tt-row-desc' },
	            (cfg.locale === 'en' ? 'Latest: ' : '最新版本：') + ((upd && upd.latest) ? 'v' + upd.latest : '—')
	            + (upd && upd.checkedAt ? (' · ' + new Date(upd.checkedAt).toLocaleString()) : '')
	            + (upd && upd.profile ? (' · profile: ' + upd.profile) : '')
	            + (upd && upd.error ? (' · ' + String(upd.error).slice(0, 60)) : '')
	          )
	        ),
	        React.createElement('span', { style: { color: updStatusColor, fontWeight: 600 } }, updStatusText)
	      ),
	      React.createElement('label', { className: 'dsh-tt-check' },
	        React.createElement('input', { type: 'checkbox', checked: !!cfg.checkUpdate, onChange: (e) => update({ checkUpdate: e.target.checked }) }),
	        ' ' + t.autoCheck
	      ),
	      React.createElement('div', { className: 'dsh-tt-actions-row' },
	        React.createElement('button', { className: 'dsh-tt-btn-lg dsh-tt-btn-lg--ghost', onClick: () => doCheck(), disabled: updChecking || updRunning }, updChecking ? t.checking : t.checkNow),
	        React.createElement('button', { className: 'dsh-tt-btn-lg dsh-tt-btn-lg--ghost', onClick: () => doCopyCmd(), disabled: updRunning }, t.copyCmd),
	        React.createElement('button', { className: 'dsh-tt-btn-lg', onClick: () => doUpdate(false), disabled: updRunning || updChecking }, updRunning ? t.updating : t.updateNow),
	        React.createElement('button', { className: 'dsh-tt-btn-lg dsh-tt-btn-lg--ghost', onClick: () => doUpdate(true), disabled: updRunning || updChecking }, t.forceReinstall)
	      ),
	      React.createElement('p', { className: 'dsh-tt-hint' }, t.reinstallHint),
	      updLog ? React.createElement('pre', { className: 'dsh-tt-log' }, updLog) : null,
	      state.hostStatus === 'error' ? React.createElement('p', { className: 'dsh-tt-hint' }, '⚠️ ' + t.hostNeeded) : null
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
