// src/config.js
// dsh-task-toast —— 共享配置与纯函数（位置 / 语言 / 查看行为 / 分类级别 / 默认值 / 配置归一化）。
//
// ⚠️ 构建说明：build-static.mjs 会把本文件内容内联进 lib/client.js（去掉 export 关键字，
// 转为顶层 const/function）；build-dynamic.mjs 也会内联进 dynamic/*.body.js。
// 因此这里只能包含无任何运行时依赖的常量与函数（不能 import 其他模块、不能引用
// ctx / React / host 等宿主符号）。

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

/** 通知分类：task = 任务完成（默认应用内提示）；error = 错误失败（默认关闭）。 */
export const CATEGORIES = [
  { id: 'task', zh: '任务完成', en: 'Task completed', def: 'app' },
  { id: 'error', zh: '错误失败', en: 'Error', def: 'off' },
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
export function sanitizeLevel(v) {
  return LEVEL_IDS.indexOf(v) >= 0 ? v : 'off'
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
export function cloneDefaultConfig() {
  return normalizeConfig(DEFAULT_CONFIG)
}
