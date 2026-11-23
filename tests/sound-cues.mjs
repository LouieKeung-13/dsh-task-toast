import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_CONFIG, normalizeConfig, SOUND_LEVEL_IDS } from '../src/config.js'
import { createTaskSoundPlayer, deliverSystemNotification, readSoundPreference, saveSoundPreference } from '../src/browser-notifications.js'

const contexts = []
class AudioMock {
  state = 'suspended'
  currentTime = 1
  tones = []
  destination = {}
  constructor() { contexts.push(this) }
  async resume() { this.state = 'running' }
  async close() { this.state = 'closed' }
  createOscillator() {
    const tone = { frequency: { setValueAtTime(value) { tone.hz = value } }, connect() {}, disconnect() { tone.disconnected = true }, start(at) { tone.start = at }, stop(at) { tone.end = at } }
    this.tones.push(tone)
    return tone
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }
  }
}
const config = (soundCues) => normalizeConfig({ soundCues })
assert.equal(DEFAULT_CONFIG.soundCues, 'off')
assert.deepEqual(SOUND_LEVEL_IDS, ['off', 'soft', 'clear'])
for (const soundCues of SOUND_LEVEL_IDS) assert.equal(config(soundCues).soundCues, soundCues)
assert.equal(config('invalid').soundCues, 'off')

const player = createTaskSoundPlayer(AudioMock)
assert.equal(player.notify({ seq: 1, category: 'task' }, config('soft')), false)
assert.equal(contexts.length, 0, 'background delivery cannot allocate a locked audio context')
assert.equal(await player.preview('off'), false)
assert.equal(contexts.length, 0, 'muting never initializes audio')
assert.equal(await player.preview('soft'), true)
const audio = contexts.at(-1)
assert.deepEqual(audio.tones.map((tone) => tone.hz), [660])
assert.equal(await player.preview('clear'), true)
assert.deepEqual(audio.tones.slice(1).map((tone) => tone.hz), [880, 1320])
const item = { seq: 101, category: 'task', title: 'Done' }
assert.equal(player.notify(item, config('soft')), true)
assert.equal(player.notify(item, config('soft')), false)
assert.equal(player.notify({ ...item, seq: 102, replaceSeq: 101 }, config('clear')), false, 'a grouped notification does not ring again')
let count = audio.tones.length
assert.equal(player.notify({ seq: 103, category: 'task' }, config('off')), false)
assert.equal(player.notify({ seq: 104, category: 'task', silent: true }, config('soft')), false)
assert.equal(player.notify({ seq: 105, category: 'task' }, { ...config('soft'), enabled: false }), false)
assert.equal(player.notify({ seq: 106, category: 'update' }, config('soft')), false)
assert.equal(audio.tones.length, count)
assert.equal(await player.preview('clear', () => false), false, 'muting during an unlock cancels a pending preview')
assert.equal(audio.tones.length, count)

let banner
class NotificationMock {
  static permission = 'granted'
  constructor(title, options) { this.options = options; banner = this }
  close() {}
}
let fallbacks = 0
player.notify({ ...item, seq: 110 }, config('clear'))
count = audio.tones.length
deliverSystemNotification(item, { NotificationApi: NotificationMock, onStatus() {}, onOpen() {}, onFallback() { fallbacks += 1 } })
assert.equal(banner.options.silent, true, 'OS task sound is suppressed so the plugin owns the sound selection')
banner.onerror()
banner.onerror()
assert.equal(fallbacks, 1)
assert.equal(audio.tones.length, count, 'overlay fallback cannot play the same task cue a second time')
player.dispose()
assert.equal(audio.state, 'closed')
assert.equal(player.notify({ ...item, seq: 111 }, config('soft')), false)
class RejectedAudio extends AudioMock { async resume() { throw Error('NotAllowedError') } }
assert.equal(await createTaskSoundPlayer(RejectedAudio).preview('soft'), false)
assert.equal(await createTaskSoundPlayer(null).preview('soft'), false)
console.log('PASS two distinct sounds, mute, grouping, audio lock, failure fallback and cleanup')

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const store = new Map()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) } })
saveSoundPreference('clear')
assert.equal(readSoundPreference('off'), 'clear')
saveSoundPreference('off')
assert.equal(readSoundPreference('soft'), 'off', 'explicit mute survives client restart')
store.clear()

async function verifyClient(isStatic) {
  const originalAudio = globalThis.AudioContext
  const originalFetch = globalThis.fetch
  const originalNotification = globalThis.Notification
  const originalDesktop = Object.getOwnPropertyDescriptor(globalThis, 'dshDesktop')
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
  if (isStatic) {
    Object.defineProperty(globalThis, 'dshDesktop', { configurable: true, value: { protocolVersion: 1 } })
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'dsh-app:' } })
  }
  const activations = []
  globalThis.AudioContext = AudioMock
  globalThis.Notification = NotificationMock
  let pendingPoll
  const effects = []
  const registrations = new Map()
  const writes = []
  const openedSessions = []
  const testedSessions = []
  let selectedSession = 'current-session'
  const uiWorkspace = {
    selection: { getSnapshot: () => ({ sessionId: selectedSession }), subscribe: () => () => {} },
    openSession(id) { openedSessions.push(id); selectedSession = id },
  }
  const hooks = []
  let hookIndex = 0
  const React = {
    Fragment: 'Fragment',
    createElement: (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat() }),
    useState(initial) {
      const index = hookIndex++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }]
    },
    useEffect() {},
  }
  const slots = { inject(name, callback) { callback() }, register(spec, factory) { registrations.set(spec.id, factory) } }
  function request(name, body) {
    if (name === 'state') return Promise.resolve({ config: normalizeConfig({ checkUpdate: false }) })
    if (name === 'version') return Promise.resolve({ local: 'test' })
    if (name.startsWith('poll')) return new Promise((resolve) => { pendingPoll = resolve })
    if (name === 'test') { testedSessions.push(body.sessionId); return Promise.resolve({ ok: true }) }
    if (name === 'config') { writes.push(body.config); return Promise.resolve({ ok: true, config: body.config }) }
    return Promise.resolve({ ok: true })
  }
  const host = { call: (name, body) => request(name.replace('tt/', ''), body) }
  globalThis.fetch = async (url, init) => {
    if (url === '/dsh-task-toast/activate') {
      assert.equal(init.method, 'POST')
      assert.equal(init.headers['X-DSH-Task-Toast'], 'activate')
      activations.push(url)
    }
    return { ok: true, json: () => request(url.replace('/dsh-task-toast/', ''), init?.body ? JSON.parse(init.body) : {}) }
  }
  const pluginPageVisits = []
  const ctx = { get: (key) => ({ pluginNavigation: { openList() { pluginPageVisits.push('plugins') } }, slots, sessions: {}, uiWorkspace, timer: { timeout() { return () => {} } } })[key], effect: (effect) => effects.push(effect()) }
  let plugin
  if (isStatic) {
    let captured
    new Function('window', readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))({ __ModuleLoader__: { load(value) { captured = value } } })
    plugin = captured.factory(() => React)
  } else {
    plugin = new Function('React', 'host', 'styles', readFileSync(new URL('../dynamic/client.body.js', import.meta.url), 'utf8'))(React, host, { insert() {} })
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  function render() { hookIndex = 0; return registrations.get('task-notifications')().tag() }
  function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)] }
  function button(tree, label) { return nodes(tree).find((node) => node.tag === 'button' && node.children.includes(label)) }
  try {
    await plugin.apply(ctx)
    await tick()
    let tree = render()
    if (isStatic) {
      const labels = nodes(tree).flatMap((node) => node.children.filter((value) => typeof value === 'string'))
      assert.ok(labels.includes('插件更新'))
      assert.ok(button(tree, '打开插件页'))
      button(tree, '打开插件页').props.onClick()
      assert.deepEqual(pluginPageVisits, ['plugins'])
      assert.equal(labels.some((label) => label.includes('同步插件文件') || label.includes('复制安装命令')), false)
      assert.equal(labels.some((label) => /\bv?\d+\.\d+\.\d+\b/.test(label)), false, 'internal version numbers must not appear in settings')
    }
    let select = nodes(tree).find((node) => node.props['aria-label'] === '任务完成音效')
    assert.ok(select, 'sound row is rendered')
    assert.deepEqual(select.children.map((option) => option.props.value), ['off', 'soft', 'clear'])
    assert.equal(button(tree, '试听').props.disabled, true)
    select.props.onChange({ target: { value: 'soft' } })
    await tick()
    tree = render()
    assert.equal(writes.at(-1).soundCues, 'soft')
    assert.equal(button(tree, '关闭音效').props.disabled, false)
    await button(tree, '试听').props.onClick()
    const context = contexts.at(-1)
    const before = context.tones.length
    pendingPoll({ items: [{ seq: 10, category: 'task', title: 'Finished', body: '**Actual result**', sessionId: 'target-session', delivery: 'system' }], seq: 10 })
    await tick()
    assert.equal(context.tones.length, before + 1)
    assert.equal(banner.options.body, 'Actual result')
    await banner.onclick()
    assert.deepEqual(openedSessions, ['target-session'], 'real uiWorkspace API must select the source conversation')
    assert.equal(activations.length, isStatic ? 1 : 0, 'Desktop static bundle must restore the native window on notification click')
    await button(render(), '发送测试通知').props.onClick()
    await tick()
    assert.equal(testedSessions.at(-1), 'target-session', 'test notification links back to the selected session')
    pendingPoll({ items: [{ seq: 11, category: 'task', title: 'Fallback', delivery: 'system' }], seq: 11 })
    await tick()
    banner.onerror()
    await tick()
    assert.equal(context.tones.length, before + 2)
    button(render(), '关闭音效').props.onClick()
    await tick()
    assert.equal(writes.at(-1).soundCues, 'off')
    assert.equal(readSoundPreference('soft'), 'off')
    tree = render()
    assert.equal(button(tree, '试听').props.disabled, true)
    pendingPoll({ items: [{ seq: 12, category: 'task', title: 'Muted', delivery: 'system' }], seq: 12 })
    await tick()
    assert.equal(context.tones.length, before + 2)
    console.log('PASS ' + (isStatic ? 'static' : 'dynamic') + ' built Client: select, preview, real dispatch, error fallback and mute')
  } finally {
    for (const dispose of effects) if (typeof dispose === 'function') dispose()
    if (pendingPoll) pendingPoll({ items: [], seq: 11 })
    globalThis.AudioContext = originalAudio
    globalThis.fetch = originalFetch
    globalThis.Notification = originalNotification
    if (originalDesktop) Object.defineProperty(globalThis, 'dshDesktop', originalDesktop)
    else delete globalThis.dshDesktop
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation)
    else delete globalThis.location
    store.clear()
  }
}
try {
  await verifyClient(true)
  await verifyClient(false)
} finally {
  if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage)
  else delete globalThis.localStorage
}
