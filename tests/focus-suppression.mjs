import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
process.env.LOCALAPPDATA = mkdtempSync(join(os.tmpdir(), 'dsh-tt-focus-'))

function makeRuntime(isStatic) {
  const routes = new Map()
  const rpc = new Map()
  const events = new Map()
  const disposers = []
  const deferredTitleReads = []
  const jobListeners = []
  let deferTitleReads = false
  const ctx = {
    timer: { timeout: () => () => {} },
    webServer: { register: (spec) => routes.set(spec.path, spec) },
    on(name, handler) {
      if (!events.has(name)) events.set(name, [])
      events.get(name).push(handler)
    },
    get(name) {
      if (name === 'sessionQuery') {
        return {
          readTitle() {
            if (!deferTitleReads) return Promise.resolve({})
            return new Promise((resolve) => deferredTitleReads.push(resolve))
          },
        }
      }
      if (name === 'jobs') return { onJobDone: (handler) => { jobListeners.push(handler); return () => {} } }
      return undefined
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
  }
  const harness = { handle: (name, handler) => rpc.set(name, handler) }

  function makeRequest(method, url, body) {
    const listeners = {}
    const req = {
      method,
      url,
      headers: { host: '127.0.0.1:43127' },
      on(name, handler) {
        listeners[name] = handler
        if (name === 'end') {
          queueMicrotask(() => {
            if (body !== undefined && listeners.data) listeners.data(Buffer.from(JSON.stringify(body)))
            handler()
          })
        }
        return req
      },
      destroy() {},
    }
    return req
  }

  async function call(name, method, body, since) {
    if (!isStatic) {
      const args = name === 'tt/poll' ? { since: since || 0 } : name === 'tt/config' ? { config: body } : body
      return rpc.get(name)(args)
    }
    const path = '/dsh-task-toast/' + name
    const spec = routes.get(path)
    assert.ok(spec, 'static Host route missing: ' + path)
    const req = makeRequest(method || 'GET', path + (name === 'poll' ? '?since=' + (since || 0) : ''), body)
    const res = {
      done: false,
      value: null,
      writeHead() {},
      end(text) {
        this.done = true
        this.value = JSON.parse(String(text))
        if (this.resolve) this.resolve(this.value)
      },
    }
    await spec.handler(req, res)
    return res
  }

  async function configure(onlyOtherSessions, taskLevel) {
    const config = {
      topmost: { mode: 'off' },
      categories: { task: taskLevel || 'app', error: 'app', update: 'app' },
      onlyOtherSessions: onlyOtherSessions !== false,
      checkUpdate: false,
    }
    if (isStatic) return call('config', 'POST', { config })
    return call('tt/config', 'POST', config)
  }

  async function setActive(sessionId, foreground, clientId) {
    const report = { sessionId, foreground, clientId }
    if (isStatic) return call('active', 'POST', report)
    return call('tt/active', 'POST', report)
  }

  async function setLegacyActive(sessionId) {
    const report = { sessionId }
    if (isStatic) return call('active', 'POST', report)
    return call('tt/active', 'POST', report)
  }

  async function systemTest() {
    if (isStatic) return call('test', 'POST', {})
    return call('tt/test', 'POST', {})
  }

  function startPoll(since) {
    let resolve
    const completion = new Promise((done) => { resolve = done })
    if (!isStatic) {
      let settled = false
      const value = rpc.get('tt/poll')({ since }).then((result) => {
        settled = true
        resolve(result)
        return result
      })
      return { isSettled: () => settled, completion, value }
    }
    const spec = routes.get('/dsh-task-toast/poll')
    const req = makeRequest('GET', '/dsh-task-toast/poll?since=' + since)
    const res = {
      done: false,
      value: null,
      resolve,
      writeHead() {},
      end(text) {
        this.done = true
        this.value = JSON.parse(String(text))
        this.resolve(this.value)
      },
    }
    spec.handler(req, res)
    return { isSettled: () => res.done, completion }
  }

  async function history() {
    if (isStatic) return (await call('history', 'GET')).value.items
    return (await call('tt/history')).items
  }

  function emit(name, payload) {
    for (const handler of events.get(name) || []) handler(payload)
  }

  function completeJob(sessionId, status = 'completed') {
    for (const handler of jobListeners) {
      handler({ ownerSession: sessionId, label: 'background job', status }, { id: sessionId })
    }
  }

  function deferTitles() { deferTitleReads = true }

  function releaseTitles() {
    deferTitleReads = false
    while (deferredTitleReads.length) deferredTitleReads.shift()({})
  }

  function dispose() {
    for (const fn of disposers) fn()
  }

  return { ctx, harness, configure, setActive, setLegacyActive, systemTest, startPoll, history, emit, completeJob, deferTitles, releaseTitles, dispose }
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function verify(label, isStatic, createPlugin) {
  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  const runtime = makeRuntime(isStatic)
  try {
    const plugin = createPlugin(runtime)
    plugin.apply(runtime.ctx)
    await runtime.configure(true, 'system')

    const focusedSession = label + '-focused-session'
    const unrelatedSession = label + '-unrelated-session'
    const expiredSession = label + '-expired-lease-session'

    await runtime.setActive(focusedSession, true, label + '-client-a').then((result) => {
      const value = isStatic ? result.value : result
      assert.deepEqual(value, { ok: true, activeSession: focusedSession }, label + ': active response preserves session compatibility')
    })
    await runtime.setActive(unrelatedSession, false, label + '-client-b')
    runtime.emit('subagent/end', { id: focusedSession, stopReason: 'completed' })
    await tick()
    assert.equal((await runtime.history()).some((item) => item.sessionId === focusedSession), false,
      label + ': onlyOtherSessions filters the focused session while idle')

    // Test notifications use the system queue contract without invoking an OS alert.
    const testPoll = runtime.startPoll(0)
    const testResponse = await runtime.systemTest()
    const value = isStatic ? testResponse.value : testResponse
    assert.deepEqual(value, { ok: true, mode: 'system', queued: true }, label + ': system test response is queue-only')
    const testDelivery = await Promise.race([
      testPoll.completion,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label + ': system test did not queue')), 1000)),
    ])
    assert.equal(testDelivery.items.length, 1, label + ': system test queues one item')
    assert.equal(testDelivery.items[0].delivery, 'system', label + ': system test item keeps system delivery')

    await runtime.configure(false, 'app')
    await runtime.setActive(focusedSession, true, label + '-client-a')
    runtime.emit('agent/status', { status: 'running', agent: { id: focusedSession } })

    let pending = runtime.startPoll(testDelivery.seq)
    runtime.deferTitles()
    runtime.completeJob(focusedSession, 'completed')
    runtime.emit('subagent/end', { id: focusedSession, stopReason: 'completed' })
    await runtime.setActive(focusedSession, false, label + '-client-a')
    runtime.releaseTitles()
    await tick()
    assert.equal(pending.isSettled(), false, label + ': asynchronous titles retain the foreground state captured at the event')
    await runtime.setActive(focusedSession, true, label + '-client-a')

    let history = await runtime.history()
    assert.ok(history.some((item) => item.sessionId === focusedSession), label + ': suppressed same-session completions remain in history')

    // A job finishing must not clear its still-running owner from focus suppression.
    runtime.emit('subagent/end', { id: focusedSession, stopReason: 'completed' })
    await tick()
    assert.equal(pending.isSettled(), false, label + ': job completion does not clear owner streaming state')

    runtime.emit('subagent/end', { id: unrelatedSession, stopReason: 'completed' })
    const delivered = await Promise.race([
      pending.completion,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label + ': unrelated event did not deliver')), 1000)),
    ])
    assert.ok(delivered.items.some((item) => item.sessionId === unrelatedSession), label + ': background-session event is delivered during focused work')
    assert.equal(delivered.items.some((item) => item.sessionId === focusedSession), false,
      label + ': suppressed same-session events do not leak into the queue')

    // Backgrounding the owning client permits a completion from its focused session.
    pending = runtime.startPoll(delivered.seq)
    await runtime.setActive(focusedSession, false, label + '-client-a')
    runtime.emit('subagent/end', { id: focusedSession, stopReason: 'completed' })
    const unfocusedDelivery = await Promise.race([
      pending.completion,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label + ': unfocused completion did not deliver')), 1000)),
    ])
    assert.ok(unfocusedDelivery.items.some((item) => item.sessionId === focusedSession), label + ': unfocused same-session completion can notify')

    // A stale foreground report expires after 30 seconds even if the agent status is still running.
    await runtime.setActive(expiredSession, true, label + '-lease-client')
    runtime.emit('agent/status', { status: 'running', agent: { id: expiredSession } })
    pending = runtime.startPoll(unfocusedDelivery.seq)
    runtime.emit('subagent/end', { id: expiredSession, stopReason: 'completed' })
    await tick()
    assert.equal(pending.isSettled(), false, label + ': a live foreground lease suppresses its running session')
    now += 30_001
    runtime.emit('subagent/end', { id: expiredSession, stopReason: 'completed' })
    const expiredDelivery = await Promise.race([
      pending.completion,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label + ': expired foreground lease stayed active')), 1000)),
    ])
    assert.ok(expiredDelivery.items.some((item) => item.sessionId === expiredSession), label + ': foreground lease expires after 30 seconds')

    // Legacy clients omit clientId and keep a sticky sessionId-only foreground lease.
    const legacySession = label + '-legacy-session'
    const legacyActive = await runtime.setLegacyActive(legacySession)
    const legacyActiveValue = isStatic ? legacyActive.value : legacyActive
    assert.deepEqual(legacyActiveValue, { ok: true, activeSession: legacySession }, label + ': legacy active response keeps its shape')
    runtime.emit('agent/status', { status: 'running', agent: { id: legacySession } })
    pending = runtime.startPoll(expiredDelivery.seq)
    runtime.emit('subagent/end', { id: legacySession, stopReason: 'completed' })
    await tick()
    assert.equal(pending.isSettled(), false, label + ': legacy sessionId-only focus suppresses same-session events')
    now += 30_001
    runtime.emit('subagent/end', { id: legacySession, stopReason: 'completed' })
    await tick()
    assert.equal(pending.isSettled(), false, label + ': legacy sessionId-only focus remains sticky past 30 seconds')
    await runtime.setLegacyActive(null)
    runtime.emit('subagent/end', { id: legacySession, stopReason: 'completed' })
    const legacyDelivery = await Promise.race([
      pending.completion,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label + ': clearing legacy focus did not restore delivery')), 1000)),
    ])
    assert.ok(legacyDelivery.items.some((item) => item.sessionId === legacySession), label + ': clearing legacy focus restores same-session delivery')

    history = await runtime.history()
    assert.ok(history.some((item) => item.sessionId === expiredSession), label + ': delivered notification remains in history')
    runtime.dispose()
    console.log('PASS ' + label + ' per-client focus lease, queue delivery, and history suppression')
  } finally {
    Date.now = originalNow
    runtime.dispose()
  }
}

const staticPlugin = (await import(pathToFileURL(join(root, 'lib', 'index.js')).href)).default
await verify('static', true, () => staticPlugin)

const dynamicBody = readFileSync(join(root, 'dynamic', 'host.body.js'), 'utf8')
const createDynamic = new Function('harness', dynamicBody)
await verify('dynamic', false, (runtime) => createDynamic(runtime.harness))
