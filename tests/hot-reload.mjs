// Isolated lifecycle regression. No profile, server, installation or Desktop restart.
// Ordinary Node uses explicit lifecycle doubles. Under Electron RUN_AS_NODE it uses
// the installed Cordis Context/Fiber and WebServer.register implementation, but still
// substitutes HTTP/DOM/React: this is NOT a live Desktop hot-update acceptance test.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { normalizeConfig } from '../lib/config.js'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const savedLocal = process.env.LOCALAPPDATA
const temp = mkdtempSync(join(tmpdir(), 'dsh-tt-reload-'))
process.env.LOCALAPPDATA = temp
const findings = []
const check = async (name, action) => {
  try { await action(); console.log('PASS ' + name) }
  catch (error) { findings.push({ name, message: error.message }); console.error('FAIL ' + name + ': ' + error.message) }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
const settle = async () => { for (let i = 0; i < 5; i += 1) await tick() }
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }

let Context
let registerRoute
if (process.versions.electron && process.env.DSH_INSTALL_DIR) {
  const require = createRequire(join(process.env.DSH_INSTALL_DIR, 'package.json'))
  const cordis = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const server = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-host-webserver')).href)
  Context = cordis.Context
  registerRoute = (server.WebServer || server.default).prototype.register
  console.log('RUNTIME installed Cordis Context/Fiber + installed WebServer.register; HTTP/DOM/React remain isolated doubles')
} else console.log('RUNTIME isolated lifecycle doubles; installed Cordis NOT loaded (use Electron RUN_AS_NODE for that coverage)')

function makeScope(root = {}) {
  const disposers = []
  const events = new Map()
  let disposed = false
  const ctx = { root, effect(fn) { if (disposed) throw Error('effect on disposed scope'); const stop = fn(); if (typeof stop === 'function') disposers.push(stop); return stop },
    on(name, fn) { const listeners = events.get(name) || new Set(); events.set(name, listeners); listeners.add(fn); ctx.effect(() => () => listeners.delete(fn)) },
    emit(name, ...args) { for (const fn of events.get(name) || []) fn(...args) },
    get(name) { return this[name] },
  }
  return { ctx, async dispose() { disposed = true; for (const stop of disposers.reverse()) await stop() } }
}
function makeTimer() {
  const timers = new Set()
  return { timers, timeout(fn, ms) { const timer = { fn, ms }; timers.add(timer); return () => timers.delete(timer) } }
}
const host = (await import('../lib/index.js')).default
async function makeHostRuntime() {
  const registry = { exact: new Map(), prefixes: new Map() }
  const routes = registry.exact
  const timer = makeTimer()
  const pendingReads = []
  const runtimeRoot = Context ? new Context() : {}
  const register = registerRoute ? registerRoute.bind(registry) : (spec) => {
    if (routes.has(spec.path)) throw Error('duplicate route ' + spec.path)
    routes.set(spec.path, spec)
    return () => routes.delete(spec.path)
  }
  const services = { timer, webServer: { register }, sessionQuery: { readTitle() { const read = deferred(); pendingReads.push(read); return read.promise } } }
  if (Context) for (const [key, value] of Object.entries(services)) runtimeRoot.provide(key, value)
  const mount = async () => {
    if (Context) {
      const fiber = runtimeRoot.plugin(host)
      await fiber
      return { ctx: fiber.ctx, dispose: () => fiber.dispose() }
    }
    const scope = makeScope(runtimeRoot)
    Object.assign(scope.ctx, services)
    host.apply(scope.ctx)
    return scope
  }
  function call(path, body, method = body ? 'POST' : 'GET', query = '') {
    const req = new EventEmitter()
    Object.assign(req, { method, url: '/dsh-task-toast/' + path + query, headers: { host: '127.0.0.1:1234', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, destroy() {} })
    const on = req.on
    req.on = function(name, fn) { on.call(this, name, fn); if (name === 'end') queueMicrotask(() => { if (body) this.emit('data', Buffer.from(JSON.stringify(body))); this.emit('end') }); return this }
    const completion = deferred()
    const response = { code: null, value: null, writeHead(code) { this.code = code }, end(text) { this.value = JSON.parse(text); completion.resolve(this.value) } }
    const route = routes.get('/dsh-task-toast/' + path)
    assert.ok(route, 'missing route ' + path)
    const returned = route.handler(req, response)
    return { req, response, completion: completion.promise, returned }
  }
  return { root: runtimeRoot, routes, timer, mount, call, pendingReads, emit(name, payload) { if (Context) runtimeRoot.emit(name, payload); else this.active.ctx.emit(name, payload) } }
}

try {
  const runtime = await makeHostRuntime()
  let first = await runtime.mount()
  runtime.active = first
  await check('all Host routes are released on unload and can be registered by replacement', async () => {
    const paths = [...runtime.routes.keys()]
    assert.ok(paths.length >= 8)
    const pending = runtime.call('poll', null, 'GET', '?since=0')
    await first.dispose()
    const pendingValue = await Promise.race([pending.completion, new Promise((_, reject) => setTimeout(() => reject(Error('pending poll never settled on unload')), 100))])
    assert.deepEqual(pendingValue.items, [])
    assert.equal(runtime.routes.size, 0, 'unload retained stale HTTP route handlers')
    const replacement = await runtime.mount()
    runtime.active = replacement
    assert.deepEqual([...runtime.routes.keys()], paths)
    await replacement.dispose()
    assert.equal(runtime.routes.size, 0)
  })
  // New runtime keeps the remaining checks independent of the route-leak assertion.
  const stateRuntime = await makeHostRuntime()
  const old = await stateRuntime.mount()
  stateRuntime.active = old
  const prefs = normalizeConfig({ locale: 'en', showSummary: false, onlyOtherSessions: false, categories: { task: 'system', error: 'off' }, topmost: { mode: 'off' } })
  await stateRuntime.call('config', { config: prefs }).completion
  await stateRuntime.call('test', { sessionId: 'before-reload' }).completion
  const queued = await stateRuntime.call('poll', null, 'GET', '?since=0').completion
  const oldSeq = queued.seq
  const oldStream = queued.streamId
  await old.dispose()
  // Remove leaked doubles only after the separate route ownership check recorded it.
  stateRuntime.routes.clear()
  const next = await stateRuntime.mount()
  stateRuntime.active = next
  await check('same-root Host reload preserves in-memory preferences and sequence/queue continuity', async () => {
    const state = await stateRuntime.call('state').completion
    assert.equal(state.config.showSummary, false, 'reload reopened hidden result summaries')
    assert.equal(state.config.locale, 'en')
    assert.equal(state.streamId, oldStream, 'same-root replacement must preserve the stream identity')
    const pending = await stateRuntime.call('poll', null, 'GET', '?since=0').completion
    assert.equal(pending.items.at(-1).sessionId, 'before-reload')
    await stateRuntime.call('test', { sessionId: 'after-reload' }).completion
    const fresh = await stateRuntime.call('poll', null, 'GET', '?since=' + oldSeq).completion
    assert.ok(fresh.seq > oldSeq)
    assert.equal(fresh.items.at(-1).sessionId, 'after-reload')
  })
  await check('replacement Host subscribes once to completion events', async () => {
    const readsBefore = stateRuntime.pendingReads.length
    stateRuntime.emit('subagent/end', { id: 'one-completion-after-reload', stopReason: 'completed' })
    await tick()
    assert.equal(stateRuntime.pendingReads.length - readsBefore, 1, 'old event subscriptions remain after reload')
    stateRuntime.pendingReads.at(-1).resolve({ title: 'Exactly once' })
    await settle()
    const records = await stateRuntime.call('history').completion
    assert.equal(records.items.filter((item) => item.sessionId === 'one-completion-after-reload').length, 1)
  })
  await next.dispose()
  const freshRuntime = await makeHostRuntime()
  const freshHost = await freshRuntime.mount()
  await check('a different Cordis root does not inherit process-local preferences', async () => {
    const state = await freshRuntime.call('state').completion
    assert.equal(state.config.showSummary, true)
    assert.notEqual(state.streamId, oldStream)
  })
  await freshHost.dispose()
  const lateRuntime = await makeHostRuntime()
  const lateHost = await lateRuntime.mount()
  lateRuntime.active = lateHost
  lateRuntime.emit('subagent/end', { id: 'late-title', stopReason: 'completed' })
  await tick()
  const originalReads = [...lateRuntime.pendingReads]
  await lateHost.dispose()
  await check('replacement Host resumes an unfinished title-read intent exactly once', async () => {
    const replacement = await lateRuntime.mount()
    lateRuntime.active = replacement
    await tick()
    const replacementReads = lateRuntime.pendingReads.slice(originalReads.length)
    assert.equal(replacementReads.length, 1, 'replacement did not resume the pending completion intent')
    // A retired callback resolving first must not consume the shared intent.
    for (const read of originalReads) read.resolve({ title: 'Old late callback' })
    await settle()
    const before = await lateRuntime.call('history').completion
    assert.equal(before.items.filter((item) => item.sessionId === 'late-title').length, 0)
    for (const read of replacementReads) read.resolve({ title: 'Replacement callback' })
    await settle()
    const after = await lateRuntime.call('history').completion
    assert.equal(after.items.filter((item) => item.sessionId === 'late-title').length, 1)
    await replacement.dispose()
    const third = await lateRuntime.mount()
    await settle()
    const replay = await lateRuntime.call('history').completion
    assert.equal(replay.items.filter((item) => item.sessionId === 'late-title').length, 1, 'a later reload replayed a consumed intent')
    await third.dispose()
  })

  const saved = new Map(['window', 'document', 'fetch', 'Notification', 'localStorage'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const styleNodes = new Set()
  const winListeners = new Map()
  const docListeners = new Map()
  const intervals = new Set()
  const selectionListeners = new Set()
  const window = { addEventListener(name, fn) { const listeners = winListeners.get(name) || new Set(); winListeners.set(name, listeners); listeners.add(fn) }, removeEventListener(name, fn) { winListeners.get(name)?.delete(fn) }, focus() {}, setInterval(fn) { intervals.add(fn); return fn }, clearInterval(fn) { intervals.delete(fn) } }
  const document = { visibilityState: 'visible', hasFocus() { return true }, addEventListener(name, fn) { const listeners = docListeners.get(name) || new Set(); docListeners.set(name, listeners); listeners.add(fn) }, removeEventListener(name, fn) { docListeners.get(name)?.delete(fn) }, querySelector() { return styleNodes.size ? [...styleNodes][0] : null }, createElement() { return { dataset: {}, setAttribute() {}, remove() { styleNodes.delete(this) } } }, head: { appendChild(node) { styleNodes.add(node); node.parentNode = this }, removeChild(node) { styleNodes.delete(node) } } }
  const banners = []
  class Notification { static permission = 'granted'; constructor(title, options) { banners.push({ title, options }); this.close = () => {} } }
  for (const [key, value] of Object.entries({ window, document, Notification, localStorage: { getItem() { return null }, setItem() {} } })) Object.defineProperty(globalThis, key, { configurable: true, value })
  const config = normalizeConfig({ categories: { task: 'system' }, topmost: { mode: 'off' } })
  let pendingPoll
  let currentFetch
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: (...args) => currentFetch(...args) })
  let effectScope
  function clientBundle() {
    let module
    new Function('window', readFileSync(join(rootDir, 'lib/client.js'), 'utf8'))({ __ModuleLoader__: { load(value) { module = value } } })
    return module.factory(() => ({
      createElement: (type, props) => typeof type === 'function' ? type(props || {}) : null,
      Fragment: 'fragment',
      useEffect(fn) { effectScope.ctx.effect(fn) },
      useState(value) { return [typeof value === 'function' ? value() : value, () => {}] },
    }))
  }
  function clientScope(root = {}) {
    const scope = makeScope(root)
    const slots = { inject(name, fn) { fn() }, register(spec, render) {
      const unregister = () => {}
      scope.ctx.effect(() => unregister)
      if (spec.id === 'task-toast-overlay') {
        effectScope = scope
        render({})
      }
      return unregister
    } }
    const uiWorkspace = { selection: { getSnapshot: () => ({ sessionId: 'current' }), subscribe(fn) { selectionListeners.add(fn); return () => selectionListeners.delete(fn) } } }
    Object.assign(scope.ctx, { get(name) { return { slots, timer: makeTimer(), sessions: {}, uiWorkspace }[name] } })
    return scope
  }
  const json = (value) => ({ ok: true, json: async () => value })
  try {
    const scope = clientScope()
    currentFetch = async (url) => {
      if (url.endsWith('/state')) return json({ config })
      if (url.endsWith('/version')) return json({})
      if (url.includes('/poll')) { pendingPoll = deferred(); return pendingPoll.promise }
      return json({ ok: true })
    }
    await clientBundle().apply(scope.ctx)
    await settle()
    assert.ok(pendingPoll, 'client never started polling')
    await scope.dispose()
    const before = banners.length
    pendingPoll.resolve(json({ seq: 1, items: [{ seq: 1, category: 'task', delivery: 'system', title: 'Disposed client result', sessionId: 'disposed-session' }] }))
    await settle()
    await check('Client ignores a pending poll response after unload', () => assert.equal(banners.length, before, 'retired Client delivered a notification'))
    await check('Client releases global input listeners and owned CSS', () => {
      assert.equal([...winListeners.values()].reduce((sum, set) => sum + set.size, 0), 0)
      assert.equal([...docListeners.values()].reduce((sum, set) => sum + set.size, 0), 0)
      assert.equal(intervals.size, 0, 'foreground heartbeat must stop on component unmount')
      assert.equal(selectionListeners.size, 0, 'selection subscription must stop on component unmount')
      assert.equal(styleNodes.size, 0, 'owned CSS remains and blocks a fresh stylesheet on reload')
    })
    // A Client-only replacement retains its cursor, while a new Host stream resets
    // the cursor before filtering the first lower-sequence notification.
    const sharedClientRoot = {}
    let streamId = 'host-stream-a'
    const polls = []
    currentFetch = async (url) => {
      if (url.endsWith('/state')) return json({ config, streamId })
      if (url.includes('/poll')) {
        const poll = deferred()
        polls.push({ url, poll })
        return poll.promise
      }
      return json({ ok: true })
    }
    const firstClient = clientScope(sharedClientRoot)
    await clientBundle().apply(firstClient.ctx)
    const bannerCount = banners.length
    polls.at(-1).poll.resolve(json({ streamId, seq: 9, items: [{ seq: 9, category: 'task', delivery: 'system', title: 'Before client reload' }] }))
    await settle()
    assert.equal(banners.length, bannerCount + 1)
    const firstPending = polls.at(-1).poll
    await firstClient.dispose()
    firstPending.resolve(json({ streamId, seq: 9, items: [] }))
    await settle()
    const secondClient = clientScope(sharedClientRoot)
    await clientBundle().apply(secondClient.ctx)
    await check('Client-only reload retains same-stream cursor without replaying old notifications', () => {
      assert.equal(new URL(polls.at(-1).url, 'http://localhost').searchParams.get('since'), '9')
      assert.equal(banners.length, bannerCount + 1)
    })
    streamId = 'host-stream-b'
    polls.at(-1).poll.resolve(json({ streamId, seq: 1, items: [{ seq: 1, category: 'task', delivery: 'system', title: 'First result from replacement Host' }] }))
    await settle()
    await check('Client resets cursor before filtering a replacement Host stream', () => {
      assert.equal(banners.at(-1).title, 'First result from replacement Host')
      assert.equal(new URL(polls.at(-1).url, 'http://localhost').searchParams.get('since'), '1')
    })
    const lastPending = polls.at(-1).poll
    await secondClient.dispose()
    lastPending.resolve(json({ streamId, seq: 1, items: [] }))
    await settle()

    // Disposal during initial state fetch must not start a pump or add listeners later.
    const initializing = clientScope()
    const initialState = deferred()
    let pollsAfterDispose = 0
    currentFetch = async (url) => {
      if (url.endsWith('/state')) return initialState.promise
      if (url.includes('/poll')) { pollsAfterDispose++; return deferred().promise }
      return json({})
    }
    const start = clientBundle().apply(initializing.ctx)
    await tick()
    await initializing.dispose()
    initialState.resolve(json({ config }))
    await check('Client disposed during initial fetch never registers late effects or starts polling', async () => {
      await start
      assert.equal(pollsAfterDispose, 0)
    })
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
} finally {
  if (savedLocal === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = savedLocal
  rmSync(temp, { recursive: true, force: true })
}
if (findings.length) {
  console.error(JSON.stringify({ lifecycleFailures: findings }, null, 2))
  process.exitCode = 1
} else console.log('PASS isolated hot-reload lifecycle checks; no real profile, HMR installation or Desktop reload was performed')
