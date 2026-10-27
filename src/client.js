// src/client.js
// dsh-task-toast —— Client 半（浏览器页面，动态插件形态）。
//
// 通过 tt/poll 长轮询 Host 通知队列 → 应用内 toast（shell.overlay，四角可选位置）
// + 可选系统通知 → 点击「查看结果」跳转会话或浮层内展开；设置页（settings.section）
// 提供位置 / 语言 / 查看行为 / 分类级别等配置，并同步回 Host。
//
// 作为动态插件使用时，请粘贴构建产物 dynamic/client.body.js（npm run build:dynamic）。
// 本文件使用动态插件环境提供的全局 React / host / styles。
import { POSITIONS, VIEW_BEHAVIORS, LOCALES, LEVELS, DEFAULT_CONFIG } from './config.js'

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
  }
  return locale === 'en' ? en : zh
}

export default {
  async apply(ctx) {
    const state = {
      config: Object.assign({}, DEFAULT_CONFIG, { categories: Object.assign({}, DEFAULT_CONFIG.categories) }),
      toasts: [],
      seq: 0,
      toastCounter: 0,
      activeSession: null,
      disposed: false,
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
        id: item.seq, ts: state.toastCounter, category: item.category,
        title: item.title, body: item.body, sessionId: item.sessionId,
        expanded: false, lifetime: typeof lifetime === 'number' ? lifetime : (state.config.autoDismissMs || 0),
      }
      state.toasts = state.toasts.concat(toast).slice(-8)
      emitter.emit()
      if (toast.lifetime > 0 && timer) timer.timeout(() => dismissToast(toast.id), toast.lifetime)
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
      React.useEffect(() => emitter.subscribe(() => setItems(state.toasts)), [])
      const cfg = state.config
      const t = ui(cfg.locale)
      if (!items.length) return React.createElement('div', { className: 'dsh-tt-host dsh-tt-host--' + cfg.position })
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
      return React.createElement('div', { className: 'dsh-tt-host dsh-tt-host--' + cfg.position }, nodes)
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
`)
  },
}
