#!/usr/bin/env node
/**
 * PLR-159 gate: no new swallowed errors, no new loose money handling.
 *
 *   node scripts/check-code-health.mjs            # fail if any file has more of a pattern than its baseline
 *   node scripts/check-code-health.mjs --update   # rewrite the baseline (do this when a count goes DOWN)
 *   node scripts/check-code-health.mjs --money=strict
 *
 * Patterns counted per file under apps/web/lib and apps/web/server (tests excluded):
 *   swallow            .catch(() => undefined|null|{}) and empty catch blocks      (always enforced)
 *   toFixed            .toFixed( outside money.ts                                  (no growth vs baseline; zero allowed with --money=strict)
 *   decimalFromNumber  new Decimal(<anything but a string literal or 0/1>)         (no growth vs baseline; zero allowed with --money=strict)
 *
 * The baseline in scripts/code-health-baseline.json is the allow-list: existing sites are classified
 * in docs/SWALLOWED_ERRORS.md and are removed area by area. A new site on a line that carries
 * `// swallow-ok: <reason>` or `// money-ok: <reason>` is not counted; the reason is required.
 * Swallows that are safe to lose should use fireAndForget() (lib/server/fire-and-forget.ts).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.env.CODE_HEALTH_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = path.join(root, 'scripts', 'code-health-baseline.json')
const roots = [path.join(root, 'apps', 'web', 'lib'), path.join(root, 'apps', 'web', 'server')]
const update = process.argv.includes('--update')
const strict = process.argv.includes('--money=strict') // fail on ANY remaining money-pattern site, not just growth
const SKIP = new Set(['money.ts', 'fire-and-forget.ts'])

const PATTERNS = {
  swallow: { optOut: /swallow-ok:\s*\S+/, res: [/\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(undefined|null|\{\s*\})\s*\)/, /\bcatch\s*(\([^)]*\))?\s*\{\s*\}/] },
  toFixed: { optOut: /money-ok:\s*\S+/, res: [/\.toFixed\(/] },
  decimalFromNumber: { optOut: /money-ok:\s*\S+/, res: [/new\s+(?:Prisma\.)?Decimal\(\s*(?!['"`]|[01]\s*\)|\)|\/\/)/] },
}

const found = { swallow: {}, toFixed: {}, decimalFromNumber: {} }
const lines = { swallow: {}, toFixed: {}, decimalFromNumber: {} }

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'generated') continue
      walk(p)
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !SKIP.has(e.name)) scan(p)
  }
}

function scan(file) {
  const rel = path.relative(root, file).split(path.sep).join('/')
  const text = fs.readFileSync(file, 'utf8').split('\n')
  text.forEach((line, i) => {
    for (const [name, { optOut, res }] of Object.entries(PATTERNS)) {
      if (!res.some((re) => re.test(line)) || optOut.test(line)) continue
      found[name][rel] = (found[name][rel] ?? 0) + 1
      ;(lines[name][rel] ??= []).push(i + 1)
    }
  })
}

for (const r of roots) if (fs.existsSync(r)) walk(r)

if (update) {
  fs.writeFileSync(baselinePath, JSON.stringify(found, null, 2) + '\n')
  const totals = Object.entries(found).map(([k, v]) => `${k} ${Object.values(v).reduce((a, b) => a + b, 0)}`)
  console.log(`[code-health] baseline written: ${totals.join(', ')}`)
  process.exit(0)
}

const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : { swallow: {}, toFixed: {}, decimalFromNumber: {} }
let failed = false
let improved = false
for (const name of Object.keys(PATTERNS)) {
  const enforce = true // baseline = allow-list: no pattern may grow in any file (money patterns included)
  const base = baseline[name] ?? {}
  let total = 0
  for (const [file, n] of Object.entries(found[name])) {
    total += n
    const allowed = base[file] ?? 0
    if (n > allowed) {
      const msg = `${name}: ${file} has ${n} (baseline ${allowed}) at line(s) ${lines[name][file].join(', ')}`
      if (enforce) {
        console.error(`[code-health] ${msg}`)
        failed = true
      } else {
        console.warn(`[code-health] (report only) ${msg}`)
      }
    }
  }
  for (const [file, allowed] of Object.entries(base)) {
    if ((found[name][file] ?? 0) < allowed) improved = true
  }
  console.log(`[code-health] ${name}: ${total} site(s) in ${Object.keys(found[name]).length} file(s)`)
  if (strict && name !== 'swallow' && total > 0) {
    console.error(`[code-health] --money=strict: ${total} ${name} site(s) remain; migrate to money.ts or annotate with // money-ok: <reason>`)
    failed = true
  }
}
if (failed) {
  console.error(
    '[code-health] New swallowed errors or money handling. Propagate the error, queue it through the outbox, use fireAndForget() for work that is safe to lose, or use lib/server/money.ts. If a site is truly fine, add `// swallow-ok: <reason>` or `// money-ok: <reason>` on its line.',
  )
  process.exit(1)
}
if (improved) console.log('[code-health] some counts are below the baseline: run with --update to lock the improvement in.')
