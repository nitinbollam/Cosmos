#!/usr/bin/env node
/**
 * PLR-151 gate: stock quantities must change through relative, guarded updates
 * ({ increment } / { decrement } with a WHERE guard), never by assigning an absolute value that was
 * computed from an earlier read - that pattern silently loses concurrent updates on Postgres.
 *
 * Flags `quantityOnHand|quantityReserved|quantityAvailable: <expr>` inside update()/updateMany()
 * calls unless the value is `{ ... }` (increment/decrement) or a literal reset to 0.
 * Opt out on a line with `// stock-write-ok: <reason>` (reason required).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'apps', 'web', 'lib', 'server')
const FIELD = /\b(quantityOnHand|quantityReserved|quantityAvailable)\s*:\s*(.+?),?\s*$/
const violations = []

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) scan(p)
  }
}

function scan(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const m = FIELD.exec(line)
    if (!m) return
    const value = m[2].trim()
    if (value.startsWith('{') || value.startsWith('true') || /^0$/.test(value)) return
    if (/^(number|Int)\b/.test(value) || /;\s*$/.test(value)) return // type/interface members
    if (/stock-write-ok:\s*\S+/.test(line)) return
    // Only inside an update/updateMany call: look back for the nearest opener.
    let ctx = ''
    for (let j = i; j >= Math.max(0, i - 8); j--) {
      ctx = lines[j] + '\n' + ctx
      if (/\.(create|createMany|upsert)\(/.test(lines[j])) break
      if (/\.(update|updateMany)\(/.test(lines[j])) {
        violations.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`)
        break
      }
    }
  })
}

walk(dir)
if (violations.length) {
  console.error('Absolute stock-quantity writes found (use increment/decrement with a guard):')
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log('check-stock-writes: ok')
