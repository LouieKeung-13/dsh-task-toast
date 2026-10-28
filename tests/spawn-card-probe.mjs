// tests/spawn-card-probe.mjs
// 真机探针：完全复刻 Host 的 spawn 方式拉起卡片脚本，观察 stdout / stderr / 退出码 / 耗时。
// 用法：node tests/spawn-card-probe.mjs [--exe <powershell 路径>] [--timeout 6000]
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const getArg = (k, d) => {
  const i = argv.indexOf(k)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

const EXE = getArg('--exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
const TIMEOUT = Number(getArg('--timeout', '6000'))
const script = join(root, 'scripts', 'card.ps1')

if (!existsSync(EXE)) { console.log('POWERSHELL_NOT_FOUND ' + EXE); process.exit(2) }
if (!existsSync(script)) { console.log('SCRIPT_NOT_FOUND ' + script); process.exit(2) }

function run(args, label) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let out = ''
    let err = ''
    let done = false
    let child
    try {
      child = spawn(EXE, args, { windowsHide: true })
    } catch (e) {
      resolve({ label, ok: false, error: 'spawn: ' + e.message, ms: 0 })
      return
    }
    const wd = setTimeout(() => { child.kill('SIGKILL'); finish(false, 'watchdog-timeout') }, 30000)
    function finish(ok, error) {
      if (done) return
      done = true
      clearTimeout(wd)
      resolve({ label, ok, error: ok ? '' : error, ms: Date.now() - t0, out: out.trim(), err: err.trim(), code: child.exitCode })
    }
    if (child.stdout) child.stdout.on('data', (d) => {
      out += String(d)
      if (out.indexOf('"stage":"shown"') >= 0) finish(true, '')
    })
    if (child.stderr) child.stderr.on('data', (d) => { err += String(d) })
    child.on('error', (e) => finish(false, 'spawn error: ' + e.message))
    child.on('close', (code) => {
      if (!done) finish(false, 'exit code=' + code)
      else resolve({ label, ok: true, ms: Date.now() - t0, out: out.trim(), err: err.trim(), code })
    })
  })
}

const base = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script]

console.log('--- 1) SelfTest（只编译 + 载入，不创建窗口）---')
const t1 = Date.now()
const r1 = await run(base.concat(['-SelfTest', '1']), 'selftest')
console.log(JSON.stringify(Object.assign({ wall: Date.now() - t1 }, r1), null, 2))

console.log('--- 2) 真弹一张卡片（' + TIMEOUT + 'ms 后自动消失）---')
const t2 = Date.now()
const r2 = await run(base.concat([
  '-Title', '探针测试卡片',
  '-Body', '这是一次真机探针，看到它就说明独立卡片链路可用。',
  '-Locale', 'zh',
  '-Position', 'bottom-right',
  '-Theme', 'auto',
  '-Accent', '#007AFF',
  '-Timeout', String(TIMEOUT),
  '-Slot', '0',
  '-Id', 'probe',
]), 'card')
console.log(JSON.stringify(Object.assign({ wall: Date.now() - t2 }, r2), null, 2))

console.log('--- 3) 只发 Windows 系统通知（不弹卡片窗口）---')
const r3 = await run(base.concat([
  '-Title', '系统通知探针',
  '-Body', '看到这条横幅说明 Windows 原生通知通道可用，并且会沉淀到通知中心。',
  '-Locale', 'zh',
  '-ToastOnly', '1',
  '-Toast', '1',
]), 'toastonly')
console.log(JSON.stringify(r3, null, 2))

console.log('--- 4) 卡片 + 系统通知 同时发 ---')
const t4 = Date.now()
const r4 = await run(base.concat([
  '-Title', '卡片 + 通知',
  '-Body', '双通道：屏幕角落一张卡片，同时一条 Windows 通知。',
  '-Locale', 'zh',
  '-Position', 'bottom-right',
  '-Timeout', '4000',
  '-Slot', '0',
  '-Id', 'probe4',
  '-Toast', '1',
]), 'card+toast')
console.log(JSON.stringify(Object.assign({ wall: Date.now() - t4 }, r4), null, 2))
