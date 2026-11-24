import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSION } from '../src/config.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const rootFiles = new Set(['.gitattributes', '.gitignore', 'package.json', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'CHANGELOG.md', 'CHANGELOG.zh.md', 'LICENSE'])
const rootDirs = new Set(['src', 'lib', 'dynamic', 'scripts', 'tests'])
const oldPluginNumber = /\bv?1\.[1-9][0-9]*\.(?:[0-9]+|x)\b/i
let files = 0
function inspect(dir, prefix = '') {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!prefix && entry.name === '.git') continue
    const relative = prefix + entry.name
    assert.equal(entry.isSymbolicLink(), false, 'unexpected symbolic link: ' + relative)
    assert.equal(oldPluginNumber.test(relative), false, 'iteration number in path: ' + relative)
    if (!prefix) assert.ok((entry.isDirectory() ? rootDirs : rootFiles).has(entry.name), 'unexpected product-root entry: ' + relative)
    if (entry.isDirectory()) inspect(join(dir, entry.name), relative + '/')
    else {
      const bytes = readFileSync(join(dir, entry.name))
      assert.equal(oldPluginNumber.test(bytes.toString('utf8')), false, 'historical plugin number in file: ' + relative)
      files += 1
    }
  }
}
inspect(root)
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
assert.equal(manifest.version, VERSION)
assert.equal(readFileSync(join(root, 'src/static/host.js'), 'utf8'), readFileSync(join(root, 'lib/index.js'), 'utf8'), 'static Host artifact differs from source')
assert.equal(readFileSync(join(root, 'src/config.js'), 'utf8'), readFileSync(join(root, 'lib/config.js'), 'utf8'), 'config artifact differs from source')
for (const file of ['README.md', 'README.zh.md']) {
  const text = readFileSync(join(root, file), 'utf8')
  assert.doesNotMatch(text, /\bv\d+\.\d+\.\d+\b|^#+.*(?:changelog|版本记录|迭代记录)/im, 'README must describe the current product')
}
console.log('PASS product integrity: ' + files + ' files scanned; no historical plugin numbers; source and artifacts agree')
