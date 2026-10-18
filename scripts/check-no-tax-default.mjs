#!/usr/bin/env node
/**
 * PLR-154 gate: there must be no hard-coded fallback tax rate in server code. Flags constants/params
 * whose name mentions tax and rate/default with a numeric literal (e.g. DEFAULT_SALES_TAX_RATE = 0.07,
 * `rate = 0.07`). Opt out on the same or previous line with `// tax-rate-allowlist: <reason>`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'apps', 'web', 'lib', 'server')
const PATTERNS = [
  /\b[A-Z_]*TAX[A-Z_]*RATE[A-Z_]*\s*=\s*0?\.\d+/, // DEFAULT_SALES_TAX_RATE = 0.07
  /\b[A-Z_]*DEFAULT[A-Z_]*TAX[A-Z_]*\s*=\s*0?\.\d+/,
  /\b(taxRate|salesTaxRate|rate)\s*=\s*0?\.0\d+\s*[,)]/, // function default param
  /\bDEFAULT\s*:\s*0?\.0\d+/, // table fallback entry
]
const bad = []
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
      const lines = fs.readFileSync(p, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!PATTERNS.some((re) => re.test(line))) return
        const ok = /tax-rate-allowlist:\s*\S+/.test(line) || /tax-rate-allowlist:\s*\S+/.test(lines[i - 1] ?? '') ||
          /tax-rate-allowlist:\s*\S+/.test(lines[i - 2] ?? '') || /tax-rate-allowlist:\s*\S+/.test(lines[i - 3] ?? '')
        if (!ok) bad.push(`${path.relative(root, p)}:${i + 1}: ${line.trim()}`)
      })
    }
  }
}
walk(dir)
if (bad.length) {
  console.error('Hard-coded tax rate fallback found (tenants must configure an explicit rate):')
  for (const b of bad) console.error('  ' + b)
  process.exit(1)
}
console.log('check-no-tax-default: ok')
