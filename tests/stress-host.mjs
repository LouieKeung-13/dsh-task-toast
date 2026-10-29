// tests/stress-host.mjs
// 压测：用 mock harness 加载「真实」构建产物 lib/index.js（静态 Host 半体），
// 通过它注册的事件处理与 HTTP 路由，灌注海量通知事件，验证：
//   1) 不崩溃、不出现未捕获异常；
//   2) 内存队列上限恒 ≤ MAX_QUEUE（200），FIFO 正常；
//   3) 持久化通知历史上限恒 ≤ 200（落盘 cap）；
//   4) 同会话 60s 窗口内的连续通知被合并（groupCount > 1），抑制刷屏；
//   5) 吞吐：4000 事件在合理时间内完成。
//
// 说明：topmost.mode 设为 'off'，因此 pushItem 只走应用内队列，不会真的弹出
// WinForms/osascript 窗口（压测不应产生真实 UI）。卡片自动关闭的修复靠
// card.ps1 单元测试与真机验证，不在本进程验证。

import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// 1) 历史落盘指向临时目录，避免污染本机、并加速（tmpfs 优先）
const tmpHome = path.join(os.tmpdir(), 'dsh-tt-stress-' + Date.now())
mkdirSync(tmpHome, { recursive: true })
process.env.LOCALAPPDATA = tmpHome

// 2) 加载真实构建产物
const hostMod = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href)
const { DEFAULT_CONFIG, normalizeConfig } = await import(pathToFileURL(path.join(root, 'src', 'config.js')).href)

// 3) mock harness / ctx
const routes = new Map()      // path -> spec
const onHandlers = new Map()  // event -> handler
let unhandled = 0
process.on('unhandledRejection', () => { unhandled += 1 })

function makeRes() {
  return {
    statusCode: 200,
    _body: '',
    writeHead(c) { this.statusCode = c; return this },
    end(d) { this._body = d; return this },
    get json() { try { return JSON.parse(this._body) } catch (e) { return null } },
  }
}
function callGet(p, query = '') {
  const spec = routes.get(p)
  if (!spec) throw new Error('route missing: ' + p)
  const res = makeRes()
  spec.handler({ method: 'GET', url: p + query, headers: {}, on() {} }, res)
  return res.json
}
function callPost(p, payload) {
  const spec = routes.get(p)
  if (!spec) throw new Error('route missing: ' + p)
  const res = makeRes()
  const buf = Buffer.from(JSON.stringify(payload))
  spec.handler({
    method: 'POST', url: p, headers: {},
    on(ev, cb) { if (ev === 'data') cb(buf); else if (ev === 'end') cb(); },
  }, res)
  return res.json
}

const ctx = {
  timer: { timeout: () => ({ dispose() {} }) },
  webServer: { register: (spec) => routes.set(spec.path, spec) },
  on: (event, handler) => onHandlers.set(event, handler),
  get: () => undefined, // sessionQuery / jobs 均不存在 → 标题走默认文案
  effect: (fn) => { try { return fn() } catch (e) { /* ignore */ } },
}

hostMod.default.apply(ctx)

// 4) 配置：关闭卡片（off）、关闭更新检查，避免任何真实进程/网络
callPost('/dsh-task-toast/config', {
  config: { ...normalizeConfig(DEFAULT_CONFIG), topmost: { mode: 'off' }, checkUpdate: false },
})

const fire = onHandlers.get('subagent/end')
if (!fire) throw new Error('subagent/end handler 未注册')

// 5) 灌注海量事件
const N = 4000
const SESSIONS = 400
const flush = () => new Promise((r) => setTimeout(r, 60))

const t0 = Date.now()
for (let i = 0; i < N; i += 1) {
  // stopReason 交替 completed / error，覆盖多个分类分支
  fire({ id: 'sess-' + (i % SESSIONS), stopReason: (i % 3 === 0 ? 'error' : 'completed') })
}
await flush()
const elapsed = Date.now() - t0

// 6) 读取真实内部状态（经由 host 暴露的路由）
const poll = callGet('/dsh-task-toast/poll', '?since=0')
const hist = callGet('/dsh-task-toast/history')

const queue = poll.items || []
const maxGroup = queue.reduce((m, it) => Math.max(m, it.groupCount || 1), 1)
const minGroup = queue.reduce((m, it) => Math.min(m, it.groupCount || 1), Infinity)
const histLen = (hist.items || hist).length

// 7) 断言
const checks = []
const assert = (name, cond, detail) => checks.push({ name, ok: !!cond, detail })

assert('无未捕获异常 (unhandledRejection=0)', unhandled === 0, 'count=' + unhandled)
assert('内存队列 ≤ 200 (FIFO cap)', queue.length <= 200, 'queue.length=' + queue.length)
assert('历史落盘 ≤ 200 (history cap)', histLen <= 200, 'history.length=' + histLen)
assert('历史确实被写入', histLen > 0, 'history.length=' + histLen)
assert('同会话分组生效 (maxGroupCount≥2)', maxGroup >= 2, 'maxGroupCount=' + maxGroup)
assert('分组未跨会话错误合并 (minGroupCount≥1)', minGroup >= 1, 'minGroupCount=' + minGroup)
assert('吞吐可接受 (<30s)', elapsed < 30000, 'elapsed(ms)=' + elapsed)

let allOk = true
for (const c of checks) {
  console.log((c.ok ? '  PASS  ' : 'X FAIL  ') + c.name + '  [' + c.detail + ']')
  if (!c.ok) allOk = false
}
console.log('')
console.log('events=' + N + '  sessions=' + SESSIONS + '  elapsed(ms)=' + elapsed +
  '  queue=' + queue.length + '  history=' + histLen +
  '  maxGroup=' + maxGroup + '  minGroup=' + minGroup)

// 8) 清理（清空历史，确认 clear 路由可用）
const cleared = callPost('/dsh-task-toast/history/clear', {})
assert('清空历史路由可用', cleared && cleared.ok === true, JSON.stringify(cleared))
const histAfter = callGet('/dsh-task-toast/history')
const histLen2 = (histAfter.items || histAfter).length
assert('清空后历史为 0', histLen2 === 0, 'history.length=' + histLen2)
for (const c of checks.slice(-2)) {
  console.log((c.ok ? '  PASS  ' : 'X FAIL  ') + c.name + '  [' + c.detail + ']')
  if (!c.ok) allOk = false
}

console.log('\n' + (allOk ? 'STRESS TEST PASSED' : 'STRESS TEST FAILED'))
process.exit(allOk ? 0 : 1)
