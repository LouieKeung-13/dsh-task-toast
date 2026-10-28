// scripts/build-static.mjs
// 构建静态安装产物（DSH 部署级插件包形态，参照 dsh-session-notify / dsh-better-sidebar 约定）：
//
//   lib/config.js   —— src/config.js 原样复制（ESM，Host 侧 import）
//   lib/index.js    —— src/static/host.js 原样复制（静态 Host 插件，export default）
//   lib/client.js   —— src/static/client.js + 内联 config.js 常量，
//                      打包为 window.__ModuleLoader__.load({ id, factory }) bundle
//
// 用法：node scripts/build-static.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const libDir = join(root, 'lib')
mkdirSync(libDir, { recursive: true })

// 1) config.js → lib/config.js（ESM）
copyFileSync(join(root, 'src', 'config.js'), join(libDir, 'config.js'))
console.log('[build-static] 已生成 lib/config.js')

// 2) static/host.js → lib/index.js（静态 Host 插件）
const hostSrc = readFileSync(join(root, 'src', 'static', 'host.js'), 'utf8')
writeFileSync(join(libDir, 'index.js'), hostSrc)
console.log('[build-static] 已生成 lib/index.js')

// 3) client bundle：config.js 内联 + static/client.js 包装
const configSrc = readFileSync(join(root, 'src', 'config.js'), 'utf8')
  .replace(/^export\s+/gm, '') // 去掉 export 关键字 → 顶层 const/function
  .trim()
const clientSrc = readFileSync(join(root, 'src', 'static', 'client.js'), 'utf8')
  .replace(/\/\/ \[build-static 在此注入 config\.js 内联常量\]\s*/, configSrc + '\n')
  .trim()

const bundle = `window.__ModuleLoader__.load({
  id: "dsh-task-toast",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    ${clientSrc.split('\n').map((l) => l === '' ? '' : '\t' + l).join('\n')}
    return module.exports;
  }
});
`
writeFileSync(join(libDir, 'client.js'), bundle)
console.log('[build-static] 已生成 lib/client.js')

// 4) 语法校验
try {
  execFileSync(process.execPath, ['--check', join(libDir, 'index.js')], { stdio: 'pipe' })
  console.log('[build-static] lib/index.js 语法 OK')
} catch (e) {
  console.error('[build-static] lib/index.js 语法错误：')
  console.error(e.stderr ? e.stderr.toString() : e.message)
  process.exit(1)
}
try {
  execFileSync(process.execPath, ['--check', join(libDir, 'client.js')], { stdio: 'pipe' })
  console.log('[build-static] lib/client.js 语法 OK')
} catch (e) {
  console.error('[build-static] lib/client.js 语法错误：')
  console.error(e.stderr ? e.stderr.toString() : e.message)
  process.exit(1)
}

// 5) client factory 主体可执行性校验（模拟 require 环境，不依赖 window/fetch 执行副作用）
const m = bundle.match(/factory: \(require\) => \{([\s\S]*)\n\}\);\s*$/)
const factoryBody = m ? m[1].replace(/\n\s*\}\s*$/, '\n') : ''
if (!factoryBody) {
  console.error('[build-static] 未能提取 factory 主体')
  process.exit(1)
}
try {
  new Function('window', 'require', 'module', 'exports', factoryBody)
  console.log('[build-static] client factory 主体可解析 OK')
} catch (e) {
  console.error('[build-static] client factory 主体解析失败：')
  console.error(e.message)
  process.exit(1)
}

// 6) PowerShell 脚本必须使用 CRLF：Windows PowerShell 5.1 的 here-string（@'...'@）
//    在 LF-only 文件里会解析错位，导致整个脚本报语法错误、卡片进程秒退（v1.5.2 教训）。
for (const rel of ['scripts/topmost.ps1', 'scripts/card.ps1']) {
  const p = join(root, rel)
  let txt = readFileSync(p, 'utf8')
  const fixed = txt.replace(/\r?\n/g, '\r\n')
  if (fixed !== txt) {
    writeFileSync(p, fixed)
    console.log('[build-static] ' + rel + ' 已规范为 CRLF（PS 5.1 here-string 兼容）')
  }
}

console.log('[build-static] 完成：lib/{config.js, index.js, client.js}')
