// scripts/build-dynamic.mjs
// 把 src/ 中的 ESM 模块打包成可直接粘贴到 cordis_define 的单文件函数体，
// 输出到 dynamic/host.body.js 与 dynamic/client.body.js。
//
// 原理：config.js 内联为函数体顶部的 const/function 声明（去掉 export），
//       host.js / client.js 去掉 import 行与 export default，保留对象字面量，
//       最终形如：const ... = [...]; ... return { inject, apply } { ... }
// 构建时用 new Function(body) 校验语法，保证产物可直接粘贴运行。
//
// 用法：node scripts/build-dynamic.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const configSrc = readFileSync(join(root, 'src', 'config.js'), 'utf8')
  .replace(/^export\s+/gm, '') // 去掉 export 关键字 → 顶层 const/function
  .trim()

function inline(moduleRel, outName, header) {
  const src = readFileSync(join(root, moduleRel), 'utf8')
    .replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '') // 去掉单行 import
    .replace(/^export\s+default\s+/m, 'return ') // export default → return（行首匹配）
    .trim()
  const body = header + '\n' + configSrc + '\n' + src + '\n'
  try {
    new Function(body) // eslint-disable-line no-new-func
  } catch (e) {
    console.error(`[build] 语法校验失败: ${outName}`)
    console.error(e.message)
    process.exit(1)
  }
  const outDir = join(root, 'dynamic')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, outName), body)
  console.log(`[build] 已生成 dynamic/${outName}`)
}

inline('src/host.js', 'host.body.js', '// 由 scripts/build-dynamic.mjs 生成 —— 可直接作为 cordis_define 的 code.host 函数体。')
inline('src/client.js', 'client.body.js', '// 由 scripts/build-dynamic.mjs 生成 —— 可直接作为 cordis_define 的 code.client 函数体。')
console.log('[build] 完成。')
