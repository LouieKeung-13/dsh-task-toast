import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const originalSpawn = childProcess.spawn
const oldProfile = process.env.DSH_PROFILE
const oldExecutable = process.env.DSH_NODE_EXECUTABLE
process.env.DSH_PROFILE = 'desktop'
process.env.DSH_NODE_EXECUTABLE = process.execPath // spawn is mocked; no real Desktop or Node is launched.
process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), 'dsh-tt-navigation-'))
const launches = []
childProcess.spawn = (file, args) => {
  launches.push({ file, args })
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => true
  queueMicrotask(() => {
    if (file === 'powershell') child.stdout.emit('data', '{"stage":"shown"}\n')
    else child.emit('exit', 0)
  })
  return child
}
syncBuiltinESMExports()
const routes = new Map()
const disposers = []
const ctx = {
  timer: { timeout: () => () => {} },
  webServer: { register: (spec) => routes.set(spec.path, spec), port: 1234 },
  on() {}, get() {},
  effect(fn) { const stop = fn(); if (typeof stop === 'function') disposers.push(stop) },
}
const headers = { host: '127.0.0.1:1234', 'content-type': 'application/json', 'x-dsh-task-toast': 'activate' }
function request(method, url, body, override = {}) {
  const req = new EventEmitter()
  Object.assign(req, { method, url, headers: { ...headers, ...override }, socket: { remoteAddress: '127.0.0.1', localPort: 1234 } })
  req.destroy = () => {}
  const on = req.on
  req.on = function(event, handler) {
    on.call(this, event, handler)
    if (event === 'end') queueMicrotask(() => { if (body) this.emit('data', Buffer.from(JSON.stringify(body))); this.emit('end') })
    return this
  }
  return req
}
function response() {
  let done
  const completion = new Promise((resolve) => { done = resolve })
  return { code: null, value: null, completion, writeHead(code) { this.code = code }, end(text) { this.value = JSON.parse(text); done(this.value) } }
}
async function call(path, body, override = {}, method = 'POST') {
  const res = response()
  await routes.get('/dsh-task-toast/' + path).handler(request(method, '/dsh-task-toast/' + path, body, override), res)
  return res
}
try {
  const { default: host } = await import('../lib/index.js')
  host.apply(ctx)
  const denied = await call('activate', {}, { origin: 'https://example.com' })
  assert.equal(denied.code, 403)
  assert.equal(launches.length, 0)
  const accepted = await call('activate', {})
  assert.equal(accepted.code, 200)
  assert.equal(accepted.value.ok, true, 'Desktop-proxied loopback request without Origin must activate')
  assert.equal(launches.at(-1).file, process.env.DSH_NODE_EXECUTABLE)
  assert.deepEqual(launches.at(-1).args, ['dsh://open'])
  const beforeInvalid = launches.length
  const invalid = await call('card-action', { id: 'unknown', action: 'view', sessionId: 'forged-session' }, { 'x-dsh-task-toast': 'card-action' })
  assert.equal(invalid.code, 404)
  assert.equal(launches.length, beforeInvalid)
  await call('config', { config: { topmost: { mode: 'card' }, categories: { task: 'app', error: 'off' } } })
  const test = await call('test', { sessionId: 'card-target' })
  assert.equal(test.value.carded, true)
  const card = launches.find((entry) => entry.file === 'powershell')
  const id = card.args[card.args.indexOf('-Id') + 1]
  const poll = response()
  const waiting = routes.get('/dsh-task-toast/poll').handler(request('GET', '/dsh-task-toast/poll?since=1'), poll)
  const viewed = await call('card-action', { id, action: 'view', sessionId: 'forged-session' }, { 'x-dsh-task-toast': 'card-action' })
  assert.equal(viewed.value.sessionId, 'card-target', 'only the stored card target is accepted')
  assert.equal(viewed.value.activation.ok, true)
  const result = await poll.completion
  await waiting
  assert.ok(Array.isArray(result.items), 'waiting Client requires an array, not a single item')
  assert.equal(result.items[0].kind, 'card-view')
  assert.equal(result.items[0].sessionId, 'card-target')
  assert.equal(result.items[0].activation.ok, true)
  console.log('PASS Host navigation: actual Desktop proxy shape, cross-origin rejection, valid card target, waiter array and native activation')
} finally {
  for (const stop of disposers) stop()
  childProcess.spawn = originalSpawn
  syncBuiltinESMExports()
  if (oldProfile === undefined) delete process.env.DSH_PROFILE
  else process.env.DSH_PROFILE = oldProfile
  if (oldExecutable === undefined) delete process.env.DSH_NODE_EXECUTABLE
  else process.env.DSH_NODE_EXECUTABLE = oldExecutable
}
