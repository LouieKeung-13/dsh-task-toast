import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
process.env.LOCALAPPDATA = mkdtempSync(join(os.tmpdir(), 'dsh-tt-content-'))
const GENERIC_BODY = (title) => `会话「${title}」的任务已完成`

function makeRuntime(isStatic) {
  const routes = new Map()
  const rpc = new Map()
  const events = new Map()
  const disposers = []
  const sessionsById = new Map()
  const surfaceById = new Map()
  const metrics = { sessionGet: 0, deriveMessages: 0, readSurface: 0, readSurfaceArgCounts: [] }
  const ctx = {
    timer: { timeout: () => () => {} },
    webServer: { register: (spec) => routes.set(spec.path, spec) },
    on(name, handler) {
      if (!events.has(name)) events.set(name, [])
      events.get(name).push(handler)
    },
    get(name) {
      if (name === 'sessions') return {
        get(id) {
          metrics.sessionGet += 1
          return sessionsById.get(id)
        },
      }
      if (name === 'sessionQuery') return {
        readTitle: async (id) => ({ title: 'title-' + id }),
        async readSurface(...args) {
          metrics.readSurface += 1
          metrics.readSurfaceArgCounts.push(args.length)
          const value = surfaceById.get(args[0])
          if (value instanceof Error) throw value
          return value || { events: [] }
        },
      }
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
    const requestUrl = name === 'poll' ? path + '?since=' + (since || 0) : path
    const req = makeRequest(method || (name === 'poll' || name === 'history' ? 'GET' : 'POST'), requestUrl, body)
    if (name === 'poll') {
      return new Promise((resolve) => {
        const res = {
          writeHead() {},
          end(text) { resolve(JSON.parse(String(text))) },
        }
        spec.handler(req, res)
      })
    }
    const res = {
      value: null,
      writeHead() {},
      end(text) { this.value = JSON.parse(String(text)) },
    }
    await spec.handler(req, res)
    return res.value
  }

  async function configure({ showSummary = true, task = 'system' } = {}) {
    const config = {
      enabled: true,
      showSummary,
      onlyOtherSessions: false,
      categories: { task, error: 'app', update: 'app' },
      topmost: { mode: 'off' },
      checkUpdate: false,
    }
    return isStatic ? call('config', 'POST', { config }) : call('tt/config', 'POST', config)
  }

  function setSession(id, deriveMessages) {
    sessionsById.set(id, {
      deriveMessages() {
        metrics.deriveMessages += 1
        if (deriveMessages instanceof Error) throw deriveMessages
        return typeof deriveMessages === 'function' ? deriveMessages() : deriveMessages
      },
    })
  }

  function setSurface(id, value) { surfaceById.set(id, value) }

  function emit(name, ...args) {
    for (const handler of events.get(name) || []) handler(...args)
  }

  async function waitForPoll(since, emitEvent) {
    const resultPromise = call(isStatic ? 'poll' : 'tt/poll', 'GET', undefined, since)
    emitEvent()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error((isStatic ? 'static' : 'dynamic') + ': notification did not reach the poll queue')), 2500)
      resultPromise.then((value) => {
        clearTimeout(timeout)
        resolve(value)
      }, (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  }

  function dispose() {
    for (const fn of disposers) fn()
  }

  return { ctx, harness, routes, rpc, metrics, configure, setSession, setSurface, emit, call, waitForPoll, dispose }
}

function makePlugin(isStatic, runtime) {
  if (isStatic) return runtime.staticPlugin
  return runtime.createDynamic(runtime.harness)
}

async function verify(label, isStatic, staticPlugin, createDynamic) {
  const runtime = makeRuntime(isStatic)
  runtime.staticPlugin = staticPlugin
  runtime.createDynamic = createDynamic
  try {
    const plugin = makePlugin(isStatic, runtime)
    plugin.apply(runtime.ctx)
    await runtime.configure({ showSummary: true, task: 'system' })

    // Prefer the live Session API. Include non-text assistant content and a tool message;
    // neither reasoning nor tool output belongs in the user-facing result excerpt.
    const liveId = label + '-live-summary'
    const reasoningSecret = label + '-reasoning-secret'
    const toolSecret = label + '-tool-output-secret'
    const toolCallSecret = label + '-assistant-tool-call-secret'
    const oldAssistantSummary = label + '-older-assistant-summary'
    const liveSummary = label + '-latest-assistant-summary'
    runtime.setSession(liveId, Promise.resolve([
      { role: 'user', content: [{ type: 'text', text: 'current user request' }] },
      { role: 'assistant', content: [{ type: 'text', text: oldAssistantSummary }] },
      { role: 'assistant', content: [
        { type: 'reasoning', text: reasoningSecret },
        { type: 'tool-call', text: toolCallSecret },
        { type: 'text', text: 'tool-call text should not surface' },
      ] },
      { role: 'tool', content: [{ type: 'text', text: toolSecret }] },
      { role: 'assistant', content: [
        { type: 'text', text: '  ' + label + '-latest-' },
        { type: 'text', text: 'assistant-summary  ' },
      ] },
    ]))
    const liveResult = await runtime.waitForPoll(0, () => runtime.emit('subagent/end', { id: liveId, stopReason: 'completed' }))
    const liveItem = liveResult.items.find((item) => item.sessionId === liveId)
    assert.ok(liveItem, label + ': completed subagent notification is delivered')
    assert.equal(liveItem.delivery, 'system', label + ': system task item retains system delivery')
    assert.ok(liveItem.body.includes(liveSummary), label + ': body contains joined text from the latest assistant response')
    assert.equal(liveItem.body.includes(oldAssistantSummary), false, label + ': body excludes older assistant responses')
    assert.equal(liveItem.body.includes(reasoningSecret), false, label + ': body excludes assistant reasoning')
    assert.equal(liveItem.body.includes(toolSecret), false, label + ': body excludes tool output')
    assert.equal(liveItem.body.includes(toolCallSecret), false, label + ': body excludes assistant tool-call payload')

    // Do not reuse an assistant response from the previous turn when a newer user turn has no reply.
    const staleId = label + '-no-current-answer'
    const staleAssistant = label + '-stale-previous-turn-secret'
    runtime.setSession(staleId, [
      { role: 'user', content: [{ type: 'text', text: 'previous user turn' }] },
      { role: 'assistant', content: [{ type: 'text', text: staleAssistant }] },
      { role: 'user', content: [{ type: 'text', text: 'new unanswered user turn' }] },
    ])
    const staleResult = await runtime.waitForPoll(liveResult.seq, () => runtime.emit('subagent/end', { id: staleId, stopReason: 'completed' }))
    const staleItem = staleResult.items.find((item) => item.sessionId === staleId)
    assert.ok(staleItem, label + ': generic notification is still delivered without a current answer')
    assert.equal(staleItem.body, GENERIC_BODY('title-' + staleId), label + ': unanswered current turn uses generic body')
    assert.equal(staleItem.body.includes(staleAssistant), false, label + ': prior-turn assistant text is not reused')

    const toolAttemptId = label + '-latest-tool-attempt'
    const olderAnswer = label + '-older-answer-before-tool-attempt'
    const toolAttemptSecret = label + '-tool-attempt-content-secret'
    runtime.setSession(toolAttemptId, [
      { role: 'user', content: [{ type: 'text', text: 'tool request' }] },
      { role: 'assistant', content: [{ type: 'text', text: olderAnswer }] },
      { role: 'assistant', tool_calls: [{ name: 'tool', arguments: '{}' }], content: [{ type: 'text', text: toolAttemptSecret }] },
    ])
    const toolAttemptResult = await runtime.waitForPoll(staleResult.seq, () => runtime.emit('subagent/end', { id: toolAttemptId, stopReason: 'completed' }))
    const toolAttemptItem = toolAttemptResult.items.find((item) => item.sessionId === toolAttemptId)
    assert.equal(toolAttemptItem.body, GENERIC_BODY('title-' + toolAttemptId), label + ': latest tool-call attempt has generic body')
    assert.equal(toolAttemptItem.body.includes(olderAnswer), false, label + ': tool-call attempt does not fall back to older assistant text')
    assert.equal(toolAttemptItem.body.includes(toolAttemptSecret), false, label + ': tool-call attempt content is excluded')

    const noTextId = label + '-latest-assistant-no-text'
    const olderTextAnswer = label + '-older-text-answer'
    const noTextReasoning = label + '-latest-reasoning-only-secret'
    runtime.setSession(noTextId, [
      { role: 'user', content: [{ type: 'text', text: 'reasoning-only turn' }] },
      { role: 'assistant', content: [{ type: 'text', text: olderTextAnswer }] },
      { role: 'assistant', content: [{ type: 'reasoning', text: noTextReasoning }] },
    ])
    const noTextResult = await runtime.waitForPoll(toolAttemptResult.seq, () => runtime.emit('subagent/end', { id: noTextId, stopReason: 'completed' }))
    const noTextItem = noTextResult.items.find((item) => item.sessionId === noTextId)
    assert.equal(noTextItem.body, GENERIC_BODY('title-' + noTextId), label + ': latest assistant message without text uses generic body')
    assert.equal(noTextItem.body.includes(olderTextAnswer), false, label + ': no-text latest assistant does not reuse older text')
    assert.equal(noTextItem.body.includes(noTextReasoning), false, label + ': reasoning-only latest assistant is excluded')

    // The read-only sessionQuery surface is the fallback when live derivation fails.
    const fallbackId = label + '-surface-fallback'
    const fallbackSummary = label + '-surface-assistant-summary'
    const fallbackReasoning = label + '-surface-reasoning-secret'
    const fallbackTool = label + '-surface-tool-secret'
    runtime.setSession(fallbackId, new Error('live derivation unavailable'))
    runtime.setSurface(fallbackId, { events: [
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'request' }] } },
      { type: 'assistant/message', data: { message: { role: 'assistant', content: [
        { type: 'reasoning', text: fallbackReasoning },
        { type: 'text', text: fallbackSummary },
      ] } } },
      { type: 'tool/result', data: { content: [{ type: 'text', text: fallbackTool }] } },
      { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: fallbackSummary }] } } },
    ] })
    const fallbackResult = await runtime.waitForPoll(noTextResult.seq, () => runtime.emit('subagent/end', { id: fallbackId, stopReason: 'completed' }))
    const fallbackItem = fallbackResult.items.find((item) => item.sessionId === fallbackId)
    assert.ok(fallbackItem.body.includes(fallbackSummary), label + ': fallback surface assistant text is included')
    assert.equal(fallbackItem.body.includes(fallbackReasoning), false, label + ': fallback excludes reasoning')
    assert.equal(fallbackItem.body.includes(fallbackTool), false, label + ': fallback excludes tool output')
    assert.equal(runtime.metrics.readSurfaceArgCounts.at(-1), 1, label + ': readSurface receives only sessionId')

    const staleSurfaceId = label + '-surface-no-current-answer'
    const staleSurfaceAssistant = label + '-stale-surface-previous-turn-secret'
    runtime.setSession(staleSurfaceId, new Error('live derivation unavailable'))
    runtime.setSurface(staleSurfaceId, { events: [
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'previous request' }] } },
      { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: staleSurfaceAssistant }] } } },
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'unanswered current request' }] } },
    ] })
    const staleSurfaceResult = await runtime.waitForPoll(fallbackResult.seq, () => runtime.emit('subagent/end', { id: staleSurfaceId, stopReason: 'completed' }))
    const staleSurfaceItem = staleSurfaceResult.items.find((item) => item.sessionId === staleSurfaceId)
    assert.equal(staleSurfaceItem.body, GENERIC_BODY('title-' + staleSurfaceId), label + ': surface fallback does not reuse prior-turn assistant text')
    assert.equal(staleSurfaceItem.body.includes(staleSurfaceAssistant), false, label + ': stale surface assistant excerpt is excluded')

    const workflowId = label + '-workflow-completion'
    const workflowSummary = label + '-workflow-latest-assistant-summary'
    runtime.setSession(workflowId, [
      { role: 'user', content: [{ type: 'text', text: 'workflow request' }] },
      { role: 'assistant', content: [{ type: 'text', text: workflowSummary }] },
    ])
    const workflowResult = await runtime.waitForPoll(staleSurfaceResult.seq, () => runtime.emit('workflow/agent-end', {}, { childId: workflowId, outcome: 'completed' }))
    const workflowItem = workflowResult.items.find((item) => item.sessionId === workflowId)
    assert.ok(workflowItem.body.includes(workflowSummary), label + ': completed workflow agent includes assistant summary')

    const idleId = label + '-agent-idle'
    const idleSummary = label + '-idle-latest-assistant-summary'
    runtime.setSession(idleId, [
      { role: 'user', content: [{ type: 'text', text: 'idle request' }] },
      { role: 'assistant', content: [{ type: 'text', text: idleSummary }] },
    ])
    const idleResult = await runtime.waitForPoll(workflowResult.seq, () => runtime.emit('agent/status', { status: 'idle', agent: { id: idleId } }))
    const idleItem = idleResult.items.find((item) => item.sessionId === idleId)
    assert.ok(idleItem.body.includes(idleSummary), label + ': agent idle completion includes assistant summary')

    // If both read paths fail, task notification still arrives with generic text.
    const failedReadId = label + '-failed-summary-read'
    runtime.setSession(failedReadId, new Error('derive failed'))
    runtime.setSurface(failedReadId, new Error('surface failed'))
    const failedReadResult = await runtime.waitForPoll(idleResult.seq, () => runtime.emit('subagent/end', { id: failedReadId, stopReason: 'completed' }))
    const failedReadItem = failedReadResult.items.find((item) => item.sessionId === failedReadId)
    assert.ok(failedReadItem, label + ': read failures do not drop task notifications')
    assert.equal(failedReadItem.body, GENERIC_BODY('title-' + failedReadId), label + ': read failures fall back to generic body')

    // showSummary=false must skip all summary reads while keeping the notification.
    await runtime.configure({ showSummary: false, task: 'system' })
    const disabledId = label + '-summary-disabled'
    runtime.setSession(disabledId, [{ role: 'assistant', content: [{ type: 'text', text: 'must-not-read' }] }])
    const readsBeforeDisabled = runtime.metrics.deriveMessages + runtime.metrics.readSurface
    const disabledResult = await runtime.waitForPoll(failedReadResult.seq, () => runtime.emit('subagent/end', { id: disabledId, stopReason: 'completed' }))
    const disabledItem = disabledResult.items.find((item) => item.sessionId === disabledId)
    assert.ok(disabledItem, label + ': showSummary=false still delivers completion')
    assert.equal(disabledItem.body, GENERIC_BODY('title-' + disabledId), label + ': showSummary=false keeps generic body')
    assert.equal(runtime.metrics.deriveMessages + runtime.metrics.readSurface, readsBeforeDisabled, label + ': showSummary=false skips summary reads')

    // Summary is capped at 4000 characters and retains the final assistant tail.
    await runtime.configure({ showSummary: true, task: 'system' })
    const longId = label + '-long-summary'
    const longTail = label + '-summary-tail-marker'
    runtime.setSession(longId, [{ role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(4500) + longTail }] }])
    const longResult = await runtime.waitForPoll(disabledResult.seq, () => runtime.emit('subagent/end', { id: longId, stopReason: 'completed' }))
    const longItem = longResult.items.find((item) => item.sessionId === longId)
    assert.ok(longItem.body.length <= 4000, label + ': composed body is capped at 4000 characters')
    assert.ok(longItem.body.endsWith(longTail), label + ': final assistant tail survives truncation')

    // /test forwards an optional sessionId and never looks up the session summary.
    const beforeTestReads = runtime.metrics.sessionGet + runtime.metrics.deriveMessages + runtime.metrics.readSurface
    const requestedSessionId = 's'.repeat(200)
    const testResult = await runtime.call(isStatic ? 'test' : 'tt/test', 'POST', { sessionId: requestedSessionId })
    assert.deepEqual(testResult, { ok: true, mode: 'system', queued: true }, label + ': system test route responds with queue contract')
    const testPoll = await runtime.call(isStatic ? 'poll' : 'tt/poll', 'GET', undefined, longResult.seq)
    const testItem = testPoll.items.find((item) => item.category === 'test')
    assert.ok(testItem, label + ': /test item is queued')
    assert.equal(testItem.sessionId, requestedSessionId, label + ': /test forwards sessionId for navigation')
    assert.equal(testItem.delivery, 'system', label + ': /test item is marked for system delivery')
    assert.equal(runtime.metrics.sessionGet + runtime.metrics.deriveMessages + runtime.metrics.readSurface, beforeTestReads, label + ': /test does not read summary content')

    const noSessionResponse = await runtime.call(isStatic ? 'test' : 'tt/test', 'POST', {})
    assert.deepEqual(noSessionResponse, { ok: true, mode: 'system', queued: true }, label + ': /test without sessionId still queues')
    const noSessionPoll = await runtime.call(isStatic ? 'poll' : 'tt/poll', 'GET', undefined, testPoll.seq)
    const noSessionItem = noSessionPoll.items.find((item) => item.category === 'test')
    assert.equal(noSessionItem.sessionId, null, label + ': /test without sessionId keeps null sessionId')
    assert.equal(runtime.metrics.sessionGet + runtime.metrics.deriveMessages + runtime.metrics.readSurface, beforeTestReads, label + ': summary remains unread for /test')

    const oversizedResponse = await runtime.call(isStatic ? 'test' : 'tt/test', 'POST', { sessionId: 'x'.repeat(201) })
    assert.deepEqual(oversizedResponse, { ok: true, mode: 'system', queued: true }, label + ': oversized /test id still queues a test item')
    const oversizedPoll = await runtime.call(isStatic ? 'poll' : 'tt/poll', 'GET', undefined, noSessionPoll.seq)
    const oversizedItem = oversizedPoll.items.find((item) => item.category === 'test')
    assert.equal(oversizedItem.sessionId, null, label + ': /test rejects sessionId longer than 200 characters')
    assert.equal(runtime.metrics.sessionGet + runtime.metrics.deriveMessages + runtime.metrics.readSurface, beforeTestReads, label + ': oversized /test does not read summaries')

    console.log('PASS ' + label + ' assistant summary extraction, privacy filtering, fallback, bounds, and test-session forwarding')
  } finally {
    runtime.dispose()
  }
}

const staticPlugin = (await import(pathToFileURL(join(root, 'lib', 'index.js')).href)).default
const dynamicBody = readFileSync(join(root, 'dynamic', 'host.body.js'), 'utf8')
const createDynamic = new Function('harness', dynamicBody)
await verify('static', true, staticPlugin, createDynamic)
await verify('dynamic', false, staticPlugin, createDynamic)
