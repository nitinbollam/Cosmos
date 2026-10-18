#!/usr/bin/env node
/**
 * Lists Prisma calls that address a tenant-owned row by its unique key without a tenantId in the same
 * `where`. Each is classified:
 *   guarded   a tenantId-bearing read or a get*(tenantId, ...) call appears earlier in the same function
 *   unguarded nothing in the function checks the tenant first
 * With TENANT_SCOPE_MODE=enforce every one of these is also corrected centrally (lib/server/tenant-scope.ts),
 * so this list shows where the code itself should still be tightened.
 *
 *   node scripts/scan-tenant-sites.mjs            print the report
 *   node scripts/scan-tenant-sites.mjs --json     machine-readable
 *   node scripts/scan-tenant-sites.mjs --max N    exit 1 if more than N unguarded sites (CI ratchet)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const web = path.join(root, 'apps/web')
const exempt = fs.readFileSync(path.join(web, 'lib/server/tenant-scope-models.ts'), 'utf8')
const exemptModels = new Set([...exempt.matchAll(/'[\w]+\.(\w+)':/g)].map((m) => m[1]))

const UNIQUE_OPS = ['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']
const CALL = new RegExp(`\\b(\\w+Db|tx)\\.(\\w+)\\.(${UNIQUE_OPS.join('|')})\\(\\{`, 'g')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'generated') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p)
  }
  return out
}

function balancedBlock(src, start) {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  return src.slice(start)
}

const sites = []
for (const file of [...walk(path.join(web, 'lib/server')), ...walk(path.join(web, 'server'))]) {
  const src = fs.readFileSync(file, 'utf8')
  const stripped = src.replace(/\/\/.*$/gm, '')
  for (const m of stripped.matchAll(CALL)) {
    const model = m[2]
    if (exemptModels.has(model[0].toUpperCase() + model.slice(1))) continue
    const block = balancedBlock(stripped, m.index + m[0].length - 1)
    const where = /where:\s*\{[^}]*\}/.exec(block)?.[0] ?? ''
    if (/tenantId/.test(where)) continue
    const line = stripped.slice(0, m.index).split('\n').length
    const before = stripped.slice(Math.max(0, m.index - 2500), m.index)
    const fnStart = Math.max(before.lastIndexOf('\nexport async function'), before.lastIndexOf('\nasync function'), before.lastIndexOf('\nfunction'), before.lastIndexOf('\nexport function'))
    const scope = fnStart >= 0 ? before.slice(fnStart) : before
    const guarded = /tenantId[^\n]*\)|get\w+\(\s*tenantId|where:\s*\{[^}]*tenantId/.test(scope)
    sites.push({ file: path.relative(root, file), line, call: `${m[1]}.${model}.${m[3]}`, status: guarded ? 'guarded' : 'unguarded' })
  }
}

const unguarded = sites.filter((s) => s.status === 'unguarded')
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: sites.length, unguarded: unguarded.length, sites }, null, 2))
} else {
  console.log(`tenant scope scan: ${sites.length} call(s) address a tenant-owned row by unique key without tenantId in the where`)
  console.log(`  guarded (tenant checked earlier in the function): ${sites.length - unguarded.length}`)
  console.log(`  unguarded: ${unguarded.length}\n`)
  for (const s of sites) console.log(`${s.status.padEnd(9)} ${s.file}:${s.line}  ${s.call}`)
}
const maxIdx = process.argv.indexOf('--max')
if (maxIdx > -1 && unguarded.length > Number(process.argv[maxIdx + 1])) {
  console.error(`\nFAIL: ${unguarded.length} unguarded site(s), allowed ${process.argv[maxIdx + 1]}`)
  process.exit(1)
}
