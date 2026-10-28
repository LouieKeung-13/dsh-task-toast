// src/config.js
// dsh-task-toast —— 共享配置与纯函数（位置 / 语言 / 查看行为 / 分类级别 / 默认值 / 配置归一化）。
//
// ⚠️ 构建说明：build-static.mjs 会把本文件内容内联进 lib/client.js（去掉 export 关键字，
// 转为顶层 const/function）；build-dynamic.mjs 也会内联进 dynamic/*.body.js。
// 因此这里只能包含无任何运行时依赖的常量与函数（不能 import 其他模块、不能引用
// ctx / React / host 等宿主符号）。

/** 插件版本（与 package.json 保持同步；Host 侧会优先读真实 package.json）。 */
export const VERSION = '1.6.1'

/** 上游仓库 owner/repo —— 更新检查与更新命令都基于它。 */
export const REPO = 'LouieKeung-13/dsh-task-toast'

/** dsh 安装源（更新命令用）。 */
export const INSTALL_SOURCE = 'github:' + REPO

/** 浮层弹出位置（四角可选）。 */
export const POSITIONS = [
  { id: 'top-left', zh: '左上角', en: 'Top-left' },
  { id: 'top-right', zh: '右上角', en: 'Top-right' },
  { id: 'bottom-left', zh: '左下角', en: 'Bottom-left' },
  { id: 'bottom-right', zh: '右下角', en: 'Bottom-right' },
]
export const POSITION_IDS = POSITIONS.map((p) => p.id)

/** 「查看结果」点击后的行为。 */
export const VIEW_BEHAVIORS = [
  { id: 'navigate', zh: '跳转到会话', en: 'Navigate to session' },
  { id: 'expand', zh: '浮层内展开内容', en: 'Expand in overlay' },
]
export const VIEW_BEHAVIOR_IDS = VIEW_BEHAVIORS.map((b) => b.id)

/** 界面语言。 */
export const LOCALES = [
  { id: 'zh', zh: '中文（简体）', en: 'Chinese (Simplified)' },
  { id: 'en', zh: '英文', en: 'English' },
]
export const LOCALE_IDS = LOCALES.map((l) => l.id)

/** 浮层主题：auto 跟随系统 / light 浅色 / dark 深色。 */
export const THEMES = [
  { id: 'auto', zh: '跟随系统', en: 'System' },
  { id: 'light', zh: '浅色', en: 'Light' },
  { id: 'dark', zh: '深色', en: 'Dark' },
]
export const THEME_IDS = THEMES.map((t) => t.id)

/** 置顶/卡片落地方式。 */
export const TOPMOST_MODES = [
  { id: 'card', zh: '独立置顶小卡片', en: 'Standalone floating card' },
  { id: 'window', zh: '提升 dsh 窗口', en: 'Raise the dsh window' },
  { id: 'off', zh: '关闭（仅应用内）', en: 'Off (in-app only)' },
]
export const TOPMOST_MODE_IDS = TOPMOST_MODES.map((m) => m.id)

/** 通知分类：task = 任务完成；error = 错误失败；update = 插件自身有新版本。 */
export const CATEGORIES = [
  { id: 'task', zh: '任务完成', en: 'Task completed', def: 'app' },
  { id: 'error', zh: '错误失败', en: 'Error', def: 'off' },
  { id: 'update', zh: '插件更新', en: 'Plugin update', def: 'app' },
]
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.id)

/** 通知级别：off 关闭 / app 仅应用内 toast / system 系统通知 + toast。 */
export const LEVELS = [
  { id: 'off', zh: '关闭', en: 'Off' },
  { id: 'app', zh: '应用内提示', en: 'In-app toast' },
  { id: 'system', zh: '系统通知', en: 'System notification' },
]
export const LEVEL_IDS = LEVELS.map((l) => l.id)

/** 默认配置（与设置页首次打开时一致）。 */
export const DEFAULT_CONFIG = {
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
export function buildUpdateCommand(profile) {
  const p = profile && String(profile).trim() ? String(profile).trim() : 'web'
  return [
    'dsh plugin --profile ' + p + ' remove dsh-task-toast',
    'dsh plugin --profile ' + p + ' add ' + INSTALL_SOURCE,
  ].join('\n')
}

/** 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0（容忍 v 前缀与缺失段）。 */
export function compareVersion(a, b) {
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
export function sanitizeLevel(v) {
  return LEVEL_IDS.indexOf(v) >= 0 ? v : 'off'
}

/** 归一化置顶配置（兼容旧配置中不存在该字段的情况）。 */
export function normalizeTopmost(input) {
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
export function normalizeConfig(input) {
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
export function cloneDefaultConfig() {
  return normalizeConfig(DEFAULT_CONFIG)
}
