// tests/env-probe.mjs —— 确认 Host 拉起 PowerShell 时子进程拿到的环境变量
import { spawn } from 'node:child_process'

const EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const cmd = '$env:LOCALAPPDATA + "|" + $env:USERPROFILE + "|" + $env:APPDATA + "|" + $env:TEMP'

function run(extraEnv) {
  return new Promise((resolve) => {
    let out = '', err = ''
    const c = spawn(EXE, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
      windowsHide: true,
      env: extraEnv ? Object.assign({}, process.env, extraEnv) : process.env,
    })
    c.stdout.on('data', (d) => { out += String(d) })
    c.stderr.on('data', (d) => { err += String(d) })
    c.on('close', () => resolve({ out: out.trim(), err: err.trim() }))
  })
}

console.log('--- 继承当前环境 ---')
console.log(JSON.stringify(await run(null)))
