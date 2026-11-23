import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { activateDesktopWindow, isDesktopActivationRequest, isCardActionRequest } from '../src/desktop-activation.js'

const env = { DSH_PROFILE: 'desktop', DSH_NODE_EXECUTABLE: 'C:/DSH/DeepSeek Harness.exe', ELECTRON_RUN_AS_NODE: '1', KEEP_ME: 'yes' }
let launches = 0
let lastLaunch
function launch(file, args, options) {
  launches += 1
  lastLaunch = { file, args, options }
  const child = new EventEmitter()
  child.kill = () => { child.killed = true }
  queueMicrotask(() => child.emit('exit', 0))
  return child
}
const settings = { env, platform: 'win32', exists: () => true, launch }
assert.deepEqual(await activateDesktopWindow(settings), { supported: true, ok: true })
assert.equal(lastLaunch.file, env.DSH_NODE_EXECUTABLE)
assert.deepEqual(lastLaunch.args, ['dsh://open'])
assert.equal(lastLaunch.options.shell, false)
assert.equal(lastLaunch.options.stdio, 'ignore')
assert.equal(lastLaunch.options.env.ELECTRON_RUN_AS_NODE, undefined)
assert.equal(lastLaunch.options.env.KEEP_ME, 'yes')
assert.equal(env.ELECTRON_RUN_AS_NODE, '1', 'launching Desktop must not change the Host environment')
for (const overrides of [{ env: { ...env, DSH_PROFILE: 'web' } }, { platform: 'darwin' }]) {
  assert.deepEqual(await activateDesktopWindow({ ...settings, ...overrides }), { ok: true, supported: false })
}
assert.equal(launches, 1, 'web and other platforms must not start Desktop')
assert.equal((await activateDesktopWindow({ ...settings, exists: () => false })).ok, false)
assert.equal(launches, 1)
assert.equal((await activateDesktopWindow({ ...settings, launch() { throw Error('no permission') } })).ok, false)
for (const event of ['error', 'exit']) {
  const failed = await activateDesktopWindow({ ...settings, launch() {
    const child = new EventEmitter()
    queueMicrotask(() => child.emit(event, event === 'error' ? Error('failed') : 1))
    return child
  } })
  assert.equal(failed.ok, false)
}
let killed = false
const timeout = await activateDesktopWindow({ ...settings, timeoutMs: 5, launch() {
  const child = new EventEmitter()
  child.kill = () => { killed = true }
  return child
} })
assert.equal(timeout.error, 'desktop-activation-timeout')
assert.equal(killed, true)
const headers = { 'x-dsh-task-toast': 'activate', 'content-type': 'application/json', host: '127.0.0.1:1234' }
assert.equal(isDesktopActivationRequest({ headers: { ...headers, origin: 'dsh-app://app' } }), true)
assert.equal(isDesktopActivationRequest({ headers: { ...headers, origin: 'http://127.0.0.1:1234' } }), true)
assert.equal(isDesktopActivationRequest({ headers: { ...headers, 'sec-fetch-site': 'same-origin' } }), true)
for (const invalid of [{}, { ...headers }, { ...headers, origin: 'https://example.com' }, { ...headers, origin: 'http://127.0.0.1:5678' }, { ...headers, origin: 'null' }, { ...headers, origin: 'dsh-app://app', 'content-type': 'text/plain' }, { ...headers, origin: 'dsh-app://app', 'x-dsh-task-toast': undefined }]) {
  assert.equal(isDesktopActivationRequest({ headers: invalid }), false)
}
// The Desktop proxy strips both Origin and Sec-Fetch-Site after checking them.
for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
  assert.equal(isDesktopActivationRequest({ headers, socket: { remoteAddress } }), true)
  assert.equal(isCardActionRequest({ headers: { ...headers, 'x-dsh-task-toast': 'card-action' }, socket: { remoteAddress } }), true)
}
assert.equal(isDesktopActivationRequest({ headers, socket: { remoteAddress: '192.0.2.2' } }), false)
assert.equal(isCardActionRequest({ headers: { ...headers, 'x-dsh-task-toast': 'card-action', origin: 'https://example.com' }, socket: { remoteAddress: '127.0.0.1' } }), false)
console.log('PASS Desktop activation: fixed executable, Desktop-only, failure/timeout handling, actual proxy headers and origin restrictions')
