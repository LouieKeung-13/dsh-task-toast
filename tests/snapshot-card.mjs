// tests/snapshot-card.mjs
// 排版自检：拉起 card.ps1 并把卡片渲染成 PNG，用于肉眼检查排版/文字重叠。
// 用法：node tests/snapshot-card.mjs [--out <dir>]
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const getArg = (k, d) => {
  const i = argv.indexOf(k)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const OUT = getArg('--out', join(root, 'tests', 'snapshots'))
const EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const script = join(root, 'scripts', 'card.ps1')

if (!existsSync(EXE)) { console.log('POWERSHELL_NOT_FOUND'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const CASES = [
  {
    name: 'zh-long',
    args: ['-Title', '测试通知', '-Body', '如果你看到这张卡片浮在所有窗口之上，说明插件已正常工作。点击「查看结果」可跳转到对应会话。', '-Locale', 'zh', '-Theme', 'dark',
      '-BtnView', '查看结果', '-BtnLater', '稍后', '-BtnIgnore', '忽略'],
  },
  {
    name: 'zh-short',
    args: ['-Title', '测试通知', '-Body', '这是一条来自任务提示插件的测试通知，用于验证通知链路。', '-Locale', 'zh', '-Theme', 'dark',
      '-BtnView', '查看结果', '-BtnLater', '稍后', '-BtnIgnore', '忽略'],
  },
  {
    name: 'zh-light',
    args: ['-Title', '任务已完成', '-Body', '这是一条来自任务提示插件的测试通知，用于验证通知链路。', '-Locale', 'zh', '-Theme', 'light',
      '-BtnView', '查看结果', '-BtnLater', '稍后', '-BtnIgnore', '忽略'],
  },
  {
    name: 'en-long',
    args: ['-Title', 'Task finished', '-Body', 'If you can see this card floating above every other window, the plugin is working correctly. Click View result to jump to the session.', '-Locale', 'en', '-Theme', 'dark',
      '-BtnView', 'View result', '-BtnLater', 'Later', '-BtnIgnore', 'Dismiss'],
  },
]

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
      resolve({ label, ok: false, error: 'spawn: ' + e.message })
      return
    }
    const wd = setTimeout(() => { try { child.kill('SIGKILL') } catch (e) { /* ignore */ } finish(false, 'timeout') }, 20000)
    function finish(ok, error) {
      if (done) return
      done = true
      clearTimeout(wd)
      resolve({ label, ok, error: ok ? '' : error, ms: Date.now() - t0, out: out.trim(), err: err.trim(), code: child.exitCode })
    }
    if (child.stdout) child.stdout.on('data', (d) => { out += String(d) })
    if (child.stderr) child.stderr.on('data', (d) => { err += String(d) })
    child.on('error', (e) => finish(false, 'spawn error: ' + e.message))
    child.on('close', (code) => finish(true, ''))
  })
}

const base = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script]
for (const c of CASES) {
  const png = join(OUT, c.name + '.png')
  const r = await run(base.concat(c.args, ['-Timeout', '6000', '-Snapshot', png]), c.name)
  console.log(c.name.padEnd(10), 'ms=' + String(r.ms).padEnd(5), 'exists=' + existsSync(png), r.error ? ('ERR ' + r.error) : '')
  if (r.err) console.log('   stderr:', r.err.slice(0, 300))
}
console.log('输出目录：' + OUT)
