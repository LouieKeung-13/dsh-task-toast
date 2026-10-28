// tests/smoke-update.mjs
// 冒烟测试：验证 v1.3.0 的「更新提醒」链路。
//
//   1) Host 插件能被 apply，并注册 8 条路由（含 version / check-update / update）
//   2) GET /version 返回本地版本号
//   3) 上游返回更高版本时：hasUpdate = true，且自动检查会推送一条 category=update 的通知
//   4) 上游版本不高于本地时：hasUpdate = false，不推送
//   5) POST /update 在 dsh CLI 缺失时优雅失败（ok=false + 日志）
//   6) client bundle 能被 ModuleLoader 加载并导出 apply / inject
//
// 用法：node tests/smoke-update.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------- GitHub API mock ----------
let upstreamVersion = '9.9.9'
globalThis.fetch = async (url) => {
  if (String(url).includes('/releases/latest')) {
    return {
      ok: true,
      json: async () => ({ tag_name: 'v' + upstreamVersion, html_url: 'https://github.com/x/y/releases/tag/v' + upstreamVersion, body: 'notes' }),
    }
  }
  throw new Error('unexpected url: ' + url)
}

// ---------- fake req / res ----------
function makeReq(method, url) {
  const h = {}
  return {
    method: method,
    url: url,
    on(ev, fn) { h[ev] = fn; return this },
    destroy() {},
  }
}
function makeRes() {
  const r = { code: 0, headers: null, body: null, done: false }
  return {
    _r: r,
    writeHead(code, headers) { r.code = code; r.headers = headers },
    end(b) { r.body = b; r.done = true },
  }
}
const parse = (res) => JSON.parse(res._r.body)

// ---------- fake ctx ----------
function makeCtx() {
  const routes = {}
  const timers = []
  const disposers = []
  const events = {}
  return {
    routes: routes,
    timers: timers,
    events: events,
    disposers: disposers,
    timer: {
      timeout(fn, ms) {
        const rec = { fn: fn, ms: ms, cancelled: false }
        timers.push(rec)
        return () => { rec.cancelled = true }
      },
    },
    webServer: {
      register(spec) { routes[spec.path] = spec },
    },
    on(name, fn) { (events[name] = events[name] || []).push(fn) },
    get() { return undefined },
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') disposers.push(d)
      return d
    },
  }
}

async function callRoute(routes, path, method, url) {
  const spec = routes[path]
  assert.ok(spec, '路由不存在：' + path)
  const req = makeReq(method, url || path)
  const res = makeRes()
  await spec.handler(req, res)
  assert.ok(res._r.done, '路由未结束响应：' + path)
  return parse(res)
}

// ================= 1) 加载 Host =================
const plugin = (await import(pathToFileURL(join(root, 'lib', 'index.js')).href)).default
assert.equal(plugin.name, 'dsh-task-toast')
const ctx = makeCtx()
plugin.apply(ctx)

const expected = [
  '/dsh-task-toast/state',
  '/dsh-task-toast/config',
  '/dsh-task-toast/active',
  '/dsh-task-toast/test',
  '/dsh-task-toast/poll',
  '/dsh-task-toast/version',
  '/dsh-task-toast/check-update',
  '/dsh-task-toast/update',
]
for (const p of expected) assert.ok(ctx.routes[p], '缺少路由 ' + p)
console.log('✓ 路由注册完整（' + expected.length + ' 条）')

// ================= 2) 本地版本 =================
const v0 = await callRoute(ctx.routes, '/dsh-task-toast/version', 'GET')
assert.equal(v0.local, '1.3.0', '本地版本应为 package.json 的 1.3.0，实际 ' + v0.local)
assert.equal(v0.hasUpdate, false)
assert.match(v0.updateCmd, /dsh plugin --profile web remove dsh-task-toast/)
assert.match(v0.updateCmd, /dsh plugin --profile web add github:LouieKeung-13\/dsh-task-toast/)
console.log('✓ /version 返回本地版本 v' + v0.local + ' 与更新命令')

// ================= 3) 上游更高 → hasUpdate + 推送通知 =================
// 先挂起一个长轮询，用于捕获自动检查推送的 update 通知
let pollResolved = null
const pollPromise = (async () => {
  const spec = ctx.routes['/dsh-task-toast/poll']
  const req = makeReq('GET', '/dsh-task-toast/poll?since=0')
  const res = makeRes()
  spec.handler(req, res) // 不 await：长轮询保持挂起
  await new Promise((r) => setTimeout(r, 400))
  pollResolved = res._r.done ? parse(res) : null
  return pollResolved
})()

// 手动触发「启动后 8s 的首检」定时器
const firstCheck = ctx.timers.find((t) => t.ms === 8000)
assert.ok(firstCheck, '未找到首检定时器')
firstCheck.fn()
await new Promise((r) => setTimeout(r, 400))

const v1 = await callRoute(ctx.routes, '/dsh-task-toast/version', 'GET')
assert.equal(v1.latest, '9.9.9')
assert.equal(v1.hasUpdate, true, '上游 9.9.9 > 本地 1.3.0，应为 true')
assert.equal(v1.url, 'https://github.com/x/y/releases/tag/v9.9.9')
console.log('✓ 检测到新版本：本地 v' + v1.local + ' → 上游 v' + v1.latest)

const polled = await pollPromise
assert.ok(polled, '长轮询未返回')
const updItem = (polled.items || []).find((i) => i.category === 'update')
assert.ok(updItem, '自动检查未推送 update 通知')
assert.match(updItem.title, /9\.9\.9/)
console.log('✓ 自动检查推送 update 通知：' + updItem.title)

// ================= 4) 上游更低 → 不更新 =================
upstreamVersion = '1.0.0'
const v2 = await callRoute(ctx.routes, '/dsh-task-toast/check-update', 'POST')
assert.equal(v2.latest, '1.0.0')
assert.equal(v2.hasUpdate, false, '上游 1.0.0 < 本地 1.3.0，应为 false')
console.log('✓ 上游版本更低时不触发更新提醒')

// 版本相等也不触发
upstreamVersion = '1.3.0'
const v3 = await callRoute(ctx.routes, '/dsh-task-toast/check-update', 'POST')
assert.equal(v3.hasUpdate, false, '版本相等不应触发')
console.log('✓ 版本相等时不触发更新提醒')

// ================= 5) 一键更新：dsh CLI 缺失时优雅失败 =================
// ⚠️ 安全保护：本机若真的装了 dsh CLI，绝不执行真实 remove/add（会破坏用户当前安装）。
// 仅在检测不到 dsh 时才调用 /update，断言其优雅失败；否则只做路由存在性校验。
import { spawnSync } from 'node:child_process'
const hasDsh = (() => {
  try {
    const r = spawnSync('dsh', ['--version'], { shell: true, windowsHide: true })
    return r && r.status === 0
  } catch (e) { return false }
})()

if (hasDsh) {
  assert.equal(typeof ctx.routes['/dsh-task-toast/update'].handler, 'function')
  assert.equal(ctx.routes['/dsh-task-toast/update'].handler.constructor.name, 'AsyncFunction')
  console.log('⚠ 本机已安装 dsh CLI —— 跳过真实 remove/add（避免误改用户安装），仅校验 /update 为异步路由')
} else {
  const up = await callRoute(ctx.routes, '/dsh-task-toast/update', 'POST')
  assert.equal(up.ok, false, '本机无 dsh CLI，应返回 ok=false')
  assert.ok(typeof up.log === 'string' && up.log.length > 0, '应返回执行日志')
  assert.ok(typeof up.removeCode === 'number' && typeof up.addCode === 'number')
  console.log('✓ /update 无 dsh CLI 时优雅失败并返回日志（removeCode=' + up.removeCode + ', addCode=' + up.addCode + '）')
}

// ================= 6) dispose 清理 =================
for (const d of ctx.disposers) { try { d() } catch (e) { /* ignore */ } }
console.log('✓ dispose 正常')

// ================= 7) 中英文案 key 必须一一对应 =================
const clientSrc = readFileSync(join(root, 'src', 'static', 'client.js'), 'utf8')
function grabKeys(name) {
  const m = clientSrc.match(new RegExp('const ' + name + ' = \\{([\\s\\S]*?)\\n  \\}'))
  assert.ok(m, '未找到 UI 字典 ' + name)
  const keys = []
  for (const line of m[1].split('\n')) {
    const km = line.match(/^\s{4}([A-Za-z0-9_]+)\s*:/)
    if (km) keys.push(km[1])
  }
  return keys
}
const zhKeys = grabKeys('zh')
const enKeys = grabKeys('en')
const onlyZh = zhKeys.filter((k) => enKeys.indexOf(k) < 0)
const onlyEn = enKeys.filter((k) => zhKeys.indexOf(k) < 0)
assert.deepEqual(onlyZh, [], '中文有、英文缺：' + onlyZh.join(', '))
assert.deepEqual(onlyEn, [], '英文有、中文缺：' + onlyEn.join(', '))
console.log('✓ UI 文案中英对照完整（' + zhKeys.length + ' 条）')

// ================= 8) client bundle 可加载 =================
const ReactMock = {
  createElement: (tag, props, ...children) => ({ tag: tag, props: props, children: children }),
  Fragment: 'Fragment',
  useState: (v) => [v, () => {}],
  useEffect: () => {},
}
let captured = null
const fakeWindow = { __ModuleLoader__: { load: (m) => { captured = m } } }
new Function('window', readFileSync(join(root, 'lib', 'client.js'), 'utf8'))(fakeWindow)
assert.ok(captured, 'client bundle 未调用 ModuleLoader.load')
assert.equal(captured.id, 'dsh-task-toast')
const exported = captured.factory((id) => {
  if (id === 'react') return ReactMock
  throw new Error('unexpected require: ' + id)
})
assert.deepEqual(exported.inject, ['slots', 'sessions', 'timer'])
assert.equal(typeof exported.apply, 'function')
console.log('✓ client bundle 导出 apply / inject 正确')

console.log('\n全部冒烟测试通过 ✅')
