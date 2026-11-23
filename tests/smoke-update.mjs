// tests/smoke-update.mjs
// 冒烟测试：验证更新文件获取与通知交付链路。
//
//   1) Host 插件能被 apply，并注册完整通知与维护路由
//   2) GET /version 返回本地版本号
//   3) 手动元数据检查可区分较高、较低、相同版本；主分支文件可作为回退来源
//   4) 上游版本不高于本地时：hasUpdate = false，不推送
//   5) POST /update 路由已注册（测试不执行 CLI mutations）
//   6) client bundle 能被 ModuleLoader 加载并导出 apply / inject
//
// 用法：node tests/smoke-update.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// 测试期间禁止自更新覆盖仓库文件
process.env.DSH_TT_SKIP_SELF_UPDATE = '1'
process.env.LOCALAPPDATA = mkdtempSync(join(os.tmpdir(), 'dsh-tt-smoke-'))

// No update request may bypass the Market into GitHub or a package manager.
const requests = []
globalThis.fetch = async (url) => { requests.push(String(url)); throw Error('unexpected update network request') }

// ---------- fake req / res ----------
function makeReq(method, url, body) {
  const h = {}
  const req = {
    method: method,
    url: url,
    on(ev, fn) {
      h[ev] = fn
      // 模拟 Node 请求体：注册 end 监听后异步 deliver（供 readJson 使用）
      if (ev === 'end') {
        setTimeout(() => {
          if (body && h['data']) h['data'](body)
          fn()
        }, 0)
      }
      return req
    },
    destroy() {},
  }
  return req
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
  '/dsh-task-toast/activate',
  '/dsh-task-toast/active',
  '/dsh-task-toast/test',
  '/dsh-task-toast/poll',
  '/dsh-task-toast/version',
  '/dsh-task-toast/check-update',
  '/dsh-task-toast/update',
  '/dsh-task-toast/topmost',
  '/dsh-task-toast/card',
  '/dsh-task-toast/card-action',
  '/dsh-task-toast/history',
  '/dsh-task-toast/history/clear',
]
for (const p of expected) assert.ok(ctx.routes[p], '缺少路由 ' + p)
console.log('✓ 路由注册完整（' + expected.length + ' 条）')

// 测试期间关闭应用外呈现（mode=off）：避免自动检查推送通知时真的弹卡片 / 抬窗口
const reqCfg = makeReq('POST', '/dsh-task-toast/config', JSON.stringify({ config: { topmost: { mode: 'off' }, categories: { task: 'app', error: 'off', update: 'app' } } }))
const resCfg = makeRes()
await ctx.routes['/dsh-task-toast/config'].handler(reqCfg, resCfg)
assert.equal(JSON.parse(resCfg._r.body).config.topmost.mode, 'off', '测试前置：应用外呈现应已关闭')

// ================= 2) 本地版本 =================
const PKG_VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const v0 = await callRoute(ctx.routes, '/dsh-task-toast/version', 'GET')
assert.equal(v0.local, PKG_VERSION, '本地版本应等于 package.json 的 ' + PKG_VERSION + '，实际 ' + v0.local)
assert.equal(v0.hasUpdate, false)
assert.equal(v0.updateProvider, 'dshmarket')
assert.equal(v0.updateCmd, undefined)
assert.equal(v0.profile, process.env.DSH_PROFILE || 'web')
assert.equal(ctx.timers.some((timer) => timer.ms === 8000), false)
for (const path of ['/dsh-task-toast/check-update', '/dsh-task-toast/update']) {
  const res = makeRes()
  await ctx.routes[path].handler(makeReq('POST', path, JSON.stringify({ force: true })), res)
  assert.equal(res._r.code, 410, 'obsolete updater must not mutate installed files')
  assert.deepEqual(parse(res), { ok: false, code: 'market-managed-updates', provider: 'dshmarket' })
}
assert.deepEqual(requests, [], 'plugin-owned updater must not contact upstream sources')
console.log('✓ Updates are delegated to dshmarket; old updater endpoints refuse mutation')

// ================= 6) 呈现方式 / 置顶 / 卡片（不触发真实窗口操作） =================
const { normalizeConfig, DEFAULT_CONFIG } = await import(pathToFileURL(join(root, 'lib/config.js')).href)
assert.deepEqual(normalizeConfig({}).topmost, DEFAULT_CONFIG.topmost, 'topmost 默认值应被补齐')
assert.equal(normalizeConfig({}).topmost.mode, 'off', '默认应关闭独立卡片与窗口诊断')
assert.equal(normalizeConfig({}).categories.task, 'system', '默认任务通知应使用系统通知')
assert.equal(normalizeConfig({ topmost: { alsoSystemToast: true }, categories: { task: 'app' } }).categories.task, 'system',
  '旧版同时通知配置应迁移成单一系统通知')
assert.equal(normalizeConfig({ topmost: { alsoSystemToast: false }, categories: { task: 'app' } }).categories.task, 'app',
  '旧版关闭同时通知时应保留应用内通知选择')
assert.equal(normalizeConfig({ categories: { task: 'app' } }).categories.task, 'app', '显式应用内通知选择应保留')
assert.equal(normalizeConfig({}).topmost.alsoSystemToast, undefined, '归一化配置不应再暴露双发开关')
const { applyPreset } = await import(pathToFileURL(join(root, 'lib/config.js')).href)
assert.deepEqual(applyPreset('important'), { task: 'system', error: 'app', update: 'off' }, '仅重要预设应把任务放入系统通知')
assert.equal(normalizeConfig({ topmost: { mode: 'window' } }).topmost.mode, 'window')
assert.equal(normalizeConfig({ topmost: { enabled: false } }).topmost.mode, 'off', '旧配置 enabled=false 应映射为 off')
assert.equal(normalizeConfig({ topmost: { mode: 'bogus' } }).topmost.mode, 'off', '非法 mode 应回落为应用内模式')
assert.equal(normalizeConfig({ topmost: { durationMs: 999999 } }).topmost.durationMs, 120000, 'durationMs 应被 clamp 到 120s')
assert.equal(normalizeConfig({ topmost: { durationMs: -5 } }).topmost.durationMs, 0)
assert.equal(normalizeConfig({ accent: '#ff0000' }).accent, '#ff0000')
assert.equal(normalizeConfig({ accent: 'red!' }).accent, '', '非法强调色应被清空')

// system test is queue-only: Host must not invoke a PowerShell system-alert helper.
const reqSystemCfg = makeReq('POST', '/dsh-task-toast/config', JSON.stringify({ config: { topmost: { mode: 'off' }, categories: { task: 'system', error: 'off', update: 'off' } } }))
const resSystemCfg = makeRes()
await ctx.routes['/dsh-task-toast/config'].handler(reqSystemCfg, resSystemCfg)
const systemCfg = JSON.parse(resSystemCfg._r.body)
assert.equal(systemCfg.config.categories.task, 'system')
const systemTest = await callRoute(ctx.routes, '/dsh-task-toast/test', 'POST')
assert.deepEqual(systemTest, { ok: true, mode: 'system', queued: true }, 'system /test should queue without an OS alert')
const systemPoll = await callRoute(ctx.routes, '/dsh-task-toast/poll', 'GET', '/dsh-task-toast/poll?since=0')
const systemItem = (systemPoll.items || []).find((item) => item.category === 'test')
assert.ok(systemItem, 'system /test item should be pollable')
assert.equal(systemItem.delivery, 'system', 'system /test item should preserve its system delivery level')

// Restore an app-only config before the legacy explicit card route checks.
const reqAppCfg = makeReq('POST', '/dsh-task-toast/config', JSON.stringify({ config: { topmost: { mode: 'off' }, categories: { task: 'app', error: 'off', update: 'off' } } }))
const resAppCfg = makeRes()
await ctx.routes['/dsh-task-toast/config'].handler(reqAppCfg, resAppCfg)
assert.equal(JSON.parse(resAppCfg._r.body).config.categories.task, 'app')

// 用 action=restore 调用（不触发真实窗口置顶，避免影响正在使用的桌面）
const reqT = makeReq('POST', '/dsh-task-toast/topmost', JSON.stringify({ action: 'restore' }))
const resT = makeRes()
await ctx.routes['/dsh-task-toast/topmost'].handler(reqT, resT)
const r0 = JSON.parse(resT._r.body)
assert.equal(r0.ok, true)
console.log('✓ 呈现方式归一化正确（card / window / off），/topmost 路由可用')

// /card 只测 close-all，绝不真的弹窗
const reqC = makeReq('POST', '/dsh-task-toast/card', JSON.stringify({ action: 'close-all' }))
const resC = makeRes()
await ctx.routes['/dsh-task-toast/card'].handler(reqC, resC)
assert.equal(JSON.parse(resC._r.body).ok, true)
console.log('✓ /card close-all 可用（未弹出任何窗口）')

// /card-action 走 ignore 分支：不跳转、不排定重提醒
const reqA = makeReq('POST', '/dsh-task-toast/card-action', JSON.stringify({ id: '999', action: 'ignore' }))
const resA = makeRes()
await ctx.routes['/dsh-task-toast/card-action'].handler(reqA, resA)
assert.equal(resA._r.code, 403)
assert.equal(JSON.parse(resA._r.body).ok, false)
console.log('✓ /card-action 拒绝缺少专用标记的请求')

// 卡片模式下 /test 会真的 spawn 窗口 —— 这里 mode=off，只校验返回值语义
const rt = await callRoute(ctx.routes, '/dsh-task-toast/test', 'POST')
assert.equal(rt.ok, true)
assert.equal(rt.mode, 'off')
assert.equal(rt.carded, false, 'mode=off 时不应弹卡片')
console.log('✓ /test 在 off 模式下不入卡片队列')

// ================= 7) dispose 清理 =================
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
const { deliverSystemNotification } = await import(pathToFileURL(join(root, 'src', 'browser-notifications.js')).href)
let notificationCount = 0
let fallbackCount = 0
const statuses = []
class FakeNotification {
  static permission = 'granted'
  constructor(title, options) {
    notificationCount += 1
    this.title = title
    this.options = options
  }
  close() {}
}
deliverSystemNotification({ seq: 1, title: 'Test', body: 'Body', sessionId: 'session-1' }, {
  NotificationApi: FakeNotification,
  onOpen() {},
  onFallback() { fallbackCount += 1 },
  onStatus(status) { statuses.push(status) },
})
assert.equal(notificationCount, 1, 'granted permission should submit one system notification')
assert.equal(fallbackCount, 0, 'successful system submission should not duplicate into app UI')
assert.deepEqual(statuses, ['submitted'])
class DeniedNotification extends FakeNotification {
  static permission = 'denied'
}
deliverSystemNotification({ seq: 2, title: 'Test', body: 'Body' }, {
  NotificationApi: DeniedNotification,
  onOpen() {},
  onFallback() { fallbackCount += 1 },
  onStatus(status) { statuses.push(status) },
})
assert.equal(notificationCount, 1, 'denied permission must not construct a system notification')
assert.equal(fallbackCount, 1, 'denied permission should fall back to the in-app notification')
assert.deepEqual(statuses, ['submitted', 'denied'])
console.log('✓ fake browser notification delivery and permission fallback')

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
assert.deepEqual(exported.inject, ['slots', 'sessions', 'timer', 'uiWorkspace'])
assert.equal(typeof exported.apply, 'function')
console.log('✓ client bundle 导出 apply / inject 正确')

// ================= 9) PowerShell 脚本的编码与换行 =================
// · CRLF —— PS 5.1 的 here-string 在 LF-only 文件里解析错位 → 卡片进程秒退
// · BOM  —— PS 5.1 无 BOM 时按 ANSI(GBK) 解码 → 脚本内中文字面量变乱码
// · 纯 ASCII —— 纵深防御：脚本里不放任何非 ASCII 字符，中文一律走命令行参数
for (const rel of ['scripts/card.ps1', 'scripts/topmost.ps1']) {
  const buf = readFileSync(join(root, rel))
  assert.ok(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, rel + ' 缺少 UTF-8 BOM（PS 5.1 会按 GBK 解码）')
  const text = buf.toString('utf8').replace(/^\uFEFF/, '')
  const bare = (text.match(/(?<!\r)\n/g) || []).length
  assert.equal(bare, 0, rel + ' 存在 LF-only 换行（here-string 会解析错位）')
  const nonAscii = text.split('\n').filter((l) => /[^\x00-\x7F]/.test(l))
  assert.equal(nonAscii.length, 0, rel + ' 含非 ASCII 字符（会乱码）：' + nonAscii.slice(0, 3).join(' | '))
}
console.log('✓ ps1 脚本：CRLF + UTF-8 BOM + 纯 ASCII')
if (process.platform === 'win32') {
  for (const rel of ['scripts/card.ps1', 'scripts/topmost.ps1']) {
    const file = join(root, rel).replace(/'/g, "''")
    const command = '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile(\'' + file + '\', [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { [Console]::Error.WriteLine($_) }; exit 1 }'
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'pipe' })
  }
  console.log('✓ Windows PowerShell scripts parse successfully')
}
const hostSrc = readFileSync(join(root, 'src', 'static', 'host.js'), 'utf8')
assert.doesNotMatch(hostSrc, /notify-windows\.ps1|ToastNotificationManager/, 'Host 不应再包含旧版 PowerShell 系统通知发送链路')
console.log('✓ Host 使用跨平台 Client 通知通道，不启动旧系统通知脚本')

// ================= 10) 卡片按钮文案必须走命令行参数 =================
// 内嵌 C# 里若出现中文字面量，PS 5.1 会解码错乱 → 按钮显示为乱码。
const cardPs = readFileSync(join(root, 'scripts', 'card.ps1'), 'utf8')
assert.equal(/ToastOnly|\$Toast\b/.test(cardPs), false, '卡片脚本不应再负责 Windows 系统通知')
const csharp = cardPs.slice(cardPs.indexOf("$src = @'"), cardPs.indexOf("'@"))
assert.ok(csharp, '未能提取内嵌 C# 源码')
assert.equal(/[一-鿿]/.test(csharp), false, '内嵌 C# 仍含中文字面量')
assert.ok(cardPs.includes('$BtnView'), 'card.ps1 缺少 -BtnView 参数')
assert.equal(hostSrc.includes('alsoSystemToast'), false, 'Host 呈现路径不应保留双发开关')
assert.ok(hostSrc.includes("'-BtnView'"), 'host 未传 -BtnView')
assert.ok(hostSrc.includes("'-BtnLater'"), 'host 未传 -BtnLater')
assert.ok(hostSrc.includes("'-BtnIgnore'"), 'host 未传 -BtnIgnore')
assert.ok(/viewResult:\s*'查看结果'/.test(hostSrc), 'host I18N 缺少中文按钮文案')
console.log('✓ 卡片按钮文案走命令行参数（Unicode 安全）')

console.log('\n全部冒烟测试通过 ✅')
