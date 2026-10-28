// tools/ascii-ify.mjs
// 把 .ps1 里的非 ASCII **注释**行转成 ASCII，避免 Windows PowerShell 5.1
// 以 GBK 解码 UTF-8 无 BOM 脚本时把注释/字面量读成乱码。
// 只处理整行注释（# / // 开头）；非注释行（含中文字面量）一律报错列出，
// 由人工确认后再改。
import { readFileSync, writeFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) { console.error('usage: node tools/ascii-ify.mjs <file.ps1>'); process.exit(1) }

const raw = readFileSync(path, 'utf8')
const lines = raw.split(/\r?\n/)
const changed = []
const risky = []

lines.forEach((line, i) => {
  if (!/[^\x00-\x7F]/.test(line)) return
  const isComment = /^\s*(#|\/\/)/.test(line)
  if (!isComment) { risky.push((i + 1) + ': ' + line.trim().slice(0, 100)); return }
  // 注释行：去掉 CJK 字符，保留 ASCII 部分
  const ascii = line.replace(/[^\x00-\x7F]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+$/, '')
  changed.push((i + 1) + ': ' + ascii)
  lines[i] = ascii
})

writeFileSync(path, lines.join('\n'), 'utf8')
const left = lines.filter((l) => /[^\x00-\x7F]/.test(l))
console.log('[' + path + '] 已转 ASCII 注释行=' + changed.length + '，剩余非 ASCII 行=' + left.length)
if (risky.length) {
  console.log('以下为非注释的含中文行（需人工处理）：')
  risky.forEach((r) => console.log('  ' + r))
}
