/**
 * dsh-task-toast — Client half (WebView / browser runtime)
 * ------------------------------------------------------------------
 * Injected into the dsh web client via `window.__ModuleLoader__`. No bundler
 * is involved, so the UI is expressed with `React.createElement` through a
 * tiny `h()` hyperscript helper (JSX is not available at runtime).
 *
 * Responsibilities:
 *   - Open a long-poll channel against the Host HTTP route and surface new
 *     completion envelopes as transient overlay toasts.
 *   - Render the overlay container into the `shell.overlay` slot (four corners),
 *     styled with dsh's design tokens (`--dsw-alias-*`).
 *   - Render a configuration panel into the `settings.section` slot so the user
 *     can pick corner + click behavior, persisted back to the Host.
 *   - Broadcast local state changes through a minimal emitter instead of forcing
 *     React re-renders from outside the tree.
 */
window.__ModuleLoader__.load({
  id: 'dsh-task-toast',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    // Hyperscript shorthand — keeps the view layer readable without a build step.
    function h(type, props, ...children) {
      return React.createElement(type, props || null, ...children)
    }

    const POSITIONS = [
      { id: 'top-left', label: 'Top-left' },
      { id: 'top-right', label: 'Top-right' },
      { id: 'bottom-left', label: 'Bottom-left' },
      { id: 'bottom-right', label: 'Bottom-right (WorkBuddy-style)' },
    ]
    const CLICK_ACTIONS = [
      { id: 'navigate', label: 'Navigate to session' },
      { id: 'expand', label: 'Expand content in overlay' },
    ]
    const DEFAULT_CONFIG = {
      enabled: true,
      position: 'bottom-right',
      clickAction: 'navigate',
      showBody: true,
    }

    const API_BASE = '/dsh-task-toast'
    const AUTO_DISMISS_MS = 10000
    const MAX_VISIBLE = 6

    function fetchJson(path, opts) {
      const init = Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {})
      return fetch(API_BASE + path, init).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
    }
    const api = {
      state: () => fetchJson('/state'),
      config: (config) => fetchJson('/config', { method: 'POST', body: JSON.stringify({ config }) }),
      test: () => fetchJson('/test', { method: 'POST' }),
      poll: (since) => fetchJson('/poll?since=' + encodeURIComponent(String(since))),
    }

    function injectStyle() {
      if (typeof document === 'undefined') return
      const tagId = 'dsh-task-toast/css'
      if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-task-toast'
      tag.dataset.pluginCss = tagId
      // `!important` avoids specificity clashes with the host stylesheet.
      tag.textContent = `
.dst-host { position: fixed; z-index: 1000; display: flex; flex-direction: column; gap: 8px; width: 320px; max-width: calc(100vw - 24px); pointer-events: none; }
.dst-host.pos-tl { top: 12px; left: 12px; }
.dst-host.pos-tr { top: 12px; right: 12px; }
.dst-host.pos-bl { bottom: 12px; left: 12px; }
.dst-host.pos-br { bottom: 12px; right: 12px; }
.dst-toast { position: relative; pointer-events: auto; display: flex; flex-direction: column; gap: 6px; padding: 12px 28px 12px 12px; border-radius: 12px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); box-shadow: 0 6px 20px rgba(0,0,0,0.18); color: var(--dsw-alias-label-primary); }
.dst-toast:hover { border-color: var(--dsw-alias-border-l2); }
.dst-title { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px; }
.dst-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); flex: none; }
.dst-body { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; word-break: break-all; white-space: pre-wrap; }
.dst-body.expanded { -webkit-line-clamp: unset; }
.dst-actions { display: flex; gap: 8px; margin-top: 2px; }
.dst-btn { font-size: 12px; padding: 5px 10px; border-radius: 6px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dst-btn:hover { border-color: var(--dsw-alias-border-l2); }
.dst-btn-primary { background: var(--dsw-alias-brand-primary); color: #fff; border-color: var(--dsw-alias-brand-primary); }
.dst-close { position: absolute; top: 6px; right: 8px; background: none; border: none; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 14px; line-height: 1; padding: 2px; }
.dst-close:hover { color: var(--dsw-alias-label-primary); }
.dst-settings { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px; }
.dst-section-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dst-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.dst-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.dst-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dst-row-label { font-size: 13px; color: var(--dsw-alias-label-primary); }
.dst-row-desc { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dst-select { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 4px 6px; font-size: 12px; }
.dst-check { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--dsw-alias-label-primary); cursor: pointer; }
`
      document.head.appendChild(tag)
    }

    const apply = async (ctx) => {
      const state = {
        config: Object.assign({}, DEFAULT_CONFIG),
        toasts: [],
        seq: 0,
        counter: 0,
        expanded: {},
        disposed: false,
      }

      // Lightweight external store: imperative mutations notify the React tree.
      const listeners = new Set()
      const emitter = {
        subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
        emit() { for (const fn of Array.from(listeners)) { try { fn() } catch (_) { /* ignore */ } } },
      }

      const timer = ctx.get('timer')
      const sessions = ctx.get('sessions')
      const slots = ctx.get('slots')

      function openSession(id) {
        if (!id || !sessions || typeof sessions.open !== 'function') return
        try { sessions.open(id) } catch (_) { /* ignore */ }
      }
      function dismiss(id) {
        state.toasts = state.toasts.filter((t) => t.id !== id)
        emitter.emit()
      }
      function addToast(item) {
        state.counter += 1
        const toast = { id: item.seq, ts: state.counter, title: item.title, body: item.body, sessionId: item.sessionId }
        state.toasts = state.toasts.concat(toast).slice(-MAX_VISIBLE)
        emitter.emit()
        if (timer) timer.timeout(() => dismiss(toast.id), AUTO_DISMISS_MS)
      }
      function ingest(items) {
        for (const item of items) addToast(item)
      }

      // Long-poll loop with simple backoff on transient failures.
      async function pump() {
        while (!state.disposed) {
          try {
            const res = await api.poll(state.seq)
            let items = []
            if (res && Array.isArray(res.items)) {
              items = res.items.filter((i) => i && typeof i.seq === 'number' && i.seq > state.seq)
            }
            if (res && typeof res.seq === 'number') state.seq = res.seq
            if (items.length) ingest(items)
          } catch (e) {
            console.error('[dsh-task-toast] poll failed', e)
            if (timer) await timer.timeout(1500)
          }
        }
      }

      try {
        const st = await api.state()
        if (st && st.config) state.config = st.config
      } catch (e) { console.error('[dsh-task-toast] state sync failed', e) }
      pump()

      ctx.effect(() => () => { state.disposed = true })

      function ToastStack() {
        const [items, setItems] = React.useState([])
        const [cfg, setCfg] = React.useState(state.config)
        React.useEffect(() => emitter.subscribe(() => { setItems(state.toasts); setCfg(state.config) }), [])
        const posClass = 'pos-' + (cfg.position || 'bottom-right')
        if (!items.length) return h('div', { className: 'dst-host ' + posClass })
        const nodes = items.map((t) => {
          const expanded = !!state.expanded[t.id]
          const onView = () => {
            if (cfg.clickAction === 'expand') {
              state.expanded[t.id] = !expanded
              emitter.emit()
            } else {
              openSession(t.sessionId)
              dismiss(t.id)
            }
          }
          return h('div', { key: String(t.id), className: 'dst-toast' },
            h('div', { className: 'dst-title' },
              h('span', { className: 'dst-dot' }),
              t.title || 'Task completed'
            ),
            state.config.showBody !== false && t.body
              ? h('div', { className: 'dst-body' + (expanded ? ' expanded' : '') }, t.body)
              : null,
            h('div', { className: 'dst-actions' },
              h('button', { className: 'dst-btn dst-btn-primary', onClick: onView },
                cfg.clickAction === 'expand' ? (expanded ? 'Collapse' : 'View result') : 'View result'),
              h('button', { className: 'dst-btn', onClick: () => dismiss(t.id) }, 'Later'),
              h('button', { className: 'dst-btn', onClick: () => dismiss(t.id) }, 'Dismiss')
            ),
            h('button', { className: 'dst-close', onClick: () => dismiss(t.id) }, '×')
          )
        })
        return h('div', { className: 'dst-host ' + posClass }, nodes)
      }

      function SettingsPanel() {
        const [cfg, setCfg] = React.useState(state.config)
        function update(patch) {
          const next = {
            enabled: patch.enabled !== undefined ? patch.enabled : cfg.enabled,
            position: patch.position !== undefined ? patch.position : cfg.position,
            clickAction: patch.clickAction !== undefined ? patch.clickAction : cfg.clickAction,
            showBody: patch.showBody !== undefined ? patch.showBody : cfg.showBody,
          }
          state.config = next
          setCfg(next)
          api.config(next).catch(() => { /* ignore persistence failure */ })
        }
        const posOpts = POSITIONS.map((p) => h('option', { key: p.id, value: p.id }, p.label))
        const actOpts = CLICK_ACTIONS.map((a) => h('option', { key: a.id, value: a.id }, a.label))
        return h('div', { className: 'dst-settings' },
          h('h3', { className: 'dst-section-title' }, 'Task notification overlay'),
          h('p', { className: 'dst-hint' }, 'When a task finishes, a corner-docked overlay appears with View / Later / Dismiss actions.'),
          h('label', { className: 'dst-check' },
            h('input', { type: 'checkbox', checked: !!cfg.enabled, onChange: (e) => update({ enabled: e.target.checked }) }),
            ' Enable task-completion notifications'),
          h('div', { className: 'dst-row' },
            h('div', { className: 'dst-row-text' },
              h('div', { className: 'dst-row-label' }, 'Overlay position'),
              h('div', { className: 'dst-row-desc' }, 'Any of the four corners')),
            h('select', { className: 'dst-select', value: cfg.position, onChange: (e) => update({ position: e.target.value }) }, posOpts)),
          h('div', { className: 'dst-row' },
            h('div', { className: 'dst-row-text' },
              h('div', { className: 'dst-row-label' }, '“View result” behavior'),
              h('div', { className: 'dst-row-desc' }, 'Navigate to the session, or expand content in-place')),
            h('select', { className: 'dst-select', value: cfg.clickAction, onChange: (e) => update({ clickAction: e.target.value }) }, actOpts)),
          h('label', { className: 'dst-check' },
            h('input', { type: 'checkbox', checked: cfg.showBody !== false, onChange: (e) => update({ showBody: e.target.checked }) }),
            ' Show result summary'),
          h('div', { className: 'dst-actions' },
            h('button', { className: 'dst-btn', onClick: () => { api.test().catch(() => {}) } }, 'Send test notification'))
        )
      }

      if (slots) {
        slots.inject('shell.overlay', () => slots.register(
          { name: 'shell.overlay', id: 'task-toast-stack', order: 2000, label: 'Task notifications' },
          () => h(ToastStack)
        ))
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'task-toast', order: 30, label: 'Task notifications' },
          () => h(SettingsPanel)
        ))
      }

      injectStyle()
    }

    module.exports = { apply, inject: ['slots', 'sessions', 'timer'] }
    return module.exports
  }
})
