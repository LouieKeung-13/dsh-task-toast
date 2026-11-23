import assert from 'node:assert/strict'
import { createNotificationSessionOpener, createForegroundReporter, openNotificationSession, watchNotificationSelection, systemNotificationExcerpt, deliverSystemNotification, requestSystemNotificationPermission, systemNotificationPermission } from '../src/browser-notifications.js'

const item = { seq: 20, replaceSeq: 12, category: 'task', title: 'Task completed', body: 'Done', sessionId: 'workspace-session' }
const statuses = []
const opened = []
let fallbacks = 0
let banner
class NotificationMock {
  static permission = 'granted'
  static async requestPermission() { this.permission = 'granted'; return this.permission }
  constructor(title, options) { this.title = title; this.options = options; banner = this }
  close() { this.closed = true }
}
function deliver(NotificationApi = NotificationMock) {
  deliverSystemNotification(item, {
    NotificationApi,
    onOpen: (id) => opened.push(id),
    onFallback: () => { fallbacks += 1 },
    onStatus: (status) => statuses.push(status),
  })
}

assert.equal(systemNotificationPermission(null), 'unsupported')
NotificationMock.permission = 'default'
assert.equal(await requestSystemNotificationPermission(NotificationMock), 'granted')
deliver()
assert.equal(statuses.at(-1), 'submitted')
assert.deepEqual(banner.options, { body: 'Done', tag: 'dsh-tt-12', renotify: false, silent: true })
banner.onshow()
banner.onerror()
assert.equal(fallbacks, 0, 'a shown system notification cannot also produce an overlay')
await banner.onclick()
assert.deepEqual(opened, ['workspace-session'])
assert.ok(banner.closed)

deliver()
banner.onerror()
banner.onerror()
assert.equal(fallbacks, 1, 'an asynchronous delivery error falls back exactly once')
assert.equal(statuses.at(-1), 'failed')

class ThrowingNotification extends NotificationMock {
  constructor() { throw new Error('renderer rejects notification') }
}
deliver(ThrowingNotification)
assert.equal(fallbacks, 2)
NotificationMock.permission = 'denied'
deliver()
assert.equal(statuses.at(-1), 'denied')
assert.equal(fallbacks, 3)
deliver(null)
assert.equal(statuses.at(-1), 'unsupported')
assert.equal(fallbacks, 4)

const navigated = []
assert.equal(await openNotificationSession('task-session', { openSession(id) { navigated.push(id) } }, {}), true)
assert.deepEqual(navigated, ['task-session'])
assert.equal(await openNotificationSession('missing', {}, {}), false)
assert.equal(await openNotificationSession('unselected', { openSession() {}, selection: { getSnapshot: () => ({ sessionId: 'other' }) } }, {}), false, 'an existing API is not enough: the source conversation must be selected')
assert.equal(await openNotificationSession('refused', { openSession() { throw Error('session unavailable') } }, {}), false)
assert.equal(systemNotificationExcerpt({ body: '## Finished\n**Result** [report](local.html)' }), 'Finished Result report')
assert.equal(systemNotificationExcerpt({ body: 'a'.repeat(4000) }).length, 240)
assert.equal(systemNotificationExcerpt({ body: 'private result' }, false), '')
let navigationFailures = 0
NotificationMock.permission = 'granted'
deliverSystemNotification(item, {
  NotificationApi: NotificationMock,
  onOpen: async () => false,
  onFallback() { throw Error('click failure is distinct from submission failure') },
  onNavigationFailure() { navigationFailures += 1 },
  onStatus: (status) => statuses.push(status),
})
await banner.onclick()
assert.equal(navigationFailures, 1)
assert.equal(statuses.at(-1), 'navigation-failed')

let selectedSession = 'selected-1'
const selectionListeners = new Set()
const selectionReports = []
const releasedReports = []
const unsubscribeSelection = watchNotificationSelection({ selection: {
  getSnapshot: () => ({ sessionId: selectedSession }),
  subscribe(listener) { selectionListeners.add(listener); return () => selectionListeners.delete(listener) },
}}, (id) => { selectionReports.push(id); return () => releasedReports.push(id) })
selectedSession = 'selected-2'
for (const listener of selectionListeners) listener()
assert.deepEqual(selectionReports, ['selected-1', 'selected-2'])
assert.deepEqual(releasedReports, ['selected-1'])
unsubscribeSelection()
assert.deepEqual(releasedReports, ['selected-1', 'selected-2'])
assert.equal(selectionListeners.size, 0)

const win = new EventTarget()
let heartbeat
win.setInterval = (callback, interval) => { assert.equal(interval, 10000); heartbeat = callback; return 1 }
win.clearInterval = (id) => { assert.equal(id, 1); heartbeat = undefined }
const doc = new EventTarget()
let focused = true
doc.hasFocus = () => focused
doc.visibilityState = 'visible'
const reports = []
const report = createForegroundReporter(async (entry) => { reports.push(entry) })
const stop = report('workspace-session', { win, doc })
const settle = async () => { await Promise.resolve(); await Promise.resolve() }
await settle()
assert.equal(reports.at(-1).foreground, true)
const clientId = reports.at(-1).clientId
focused = false
win.dispatchEvent(new Event('blur'))
await settle()
assert.deepEqual(reports.at(-1), { clientId, sessionId: 'workspace-session', foreground: false })
focused = true
win.dispatchEvent(new Event('focus'))
await settle()
assert.equal(reports.at(-1).foreground, true)
doc.visibilityState = 'hidden'
doc.dispatchEvent(new Event('visibilitychange'))
await settle()
assert.equal(reports.at(-1).foreground, false)
doc.visibilityState = 'visible'
heartbeat()
await settle()
assert.equal(reports.at(-1).foreground, true)
stop()
await settle()
assert.equal(reports.at(-1).foreground, false)
assert.equal(heartbeat, undefined)
const reportCount = reports.length
win.dispatchEvent(new Event('focus'))
await settle()
assert.equal(reports.length, reportCount)
// A minimized or tray-hidden Desktop must activate before its target is opened.
for (const initialState of ['minimized', 'tray-hidden']) {
  const actions = []
  let windowState = initialState
  let selected = 'previous-session'
  const opener = createNotificationSessionOpener({
    openSession(id) { assert.equal(windowState, 'visible'); selected = id; actions.push('open:' + id) },
    selection: { getSnapshot: () => ({ sessionId: selected }) },
  }, {}, async () => { actions.push('activate'); windowState = 'visible'; return { ok: true } })
  deliverSystemNotification(item, {
    NotificationApi: NotificationMock, onOpen: opener,
    onFallback() { assert.fail('unexpected fallback') },
    onStatus() {}, onNavigationFailure() { assert.fail('unexpected navigation failure') },
  })
  await banner.onclick()
  assert.deepEqual(actions, ['activate', 'open:workspace-session'])
  assert.equal(selected, item.sessionId)
}
const pendingActivations = []
const openedAfterActivation = []
const orderedOpen = createNotificationSessionOpener({ openSession(id) { openedAfterActivation.push(id) } }, {}, () => new Promise((resolve) => pendingActivations.push(resolve)))
const oldClick = orderedOpen('older-target')
const newClick = orderedOpen('latest-target')
pendingActivations[1]({ ok: true })
assert.equal(await newClick, true)
pendingActivations[0]({ ok: true })
assert.equal(await oldClick, true)
assert.deepEqual(openedAfterActivation, ['latest-target'], 'a slow older activation must not overwrite the latest click')
const failedActivationOpen = createNotificationSessionOpener({ openSession(id) { openedAfterActivation.push(id) } }, {}, async () => { throw Error('Host unreachable') })
assert.equal(await failedActivationOpen('fallback-target'), false)
assert.equal(openedAfterActivation.at(-1), 'fallback-target', 'retain navigation even when native activation fails, but report failure')
assert.equal(await orderedOpen('already-restored-card', { restoreWindow: false }), true)
assert.equal(pendingActivations.length, 2, 'Host-activated cards must not activate twice')
console.log('✓ Browser notification permission, fallback, activation and foreground lifecycle')
