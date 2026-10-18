#!/usr/bin/env node
/**
 * Runs `node --test` over glob patterns on any supported Node version.
 *
 * `node --test 'src/**\/*.test.ts'` only expands globs on Node 21+, but this project targets Node 20
 * (engines and the Docker images), where the pattern is treated as a literal file name and the run fails.
 *
 *   node scripts/run-tests.mjs [--import <module>]... <pattern>...
 *
 * Patterns may use `*` within a path segment and `**` for any depth, relative to the current directory.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const imports = []
const patterns = []
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--import') imports.push('--import', args[++i])
  else patterns.push(args[i])
}
if (!patterns.length) {
  console.error('run-tests: no test patterns given')
  process.exit(2)
}

const escape = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
function toRegExp(pattern) {
  const body = pattern
    .split('/')
    .map((seg) => (seg === '**' ? '(?:.*/)?' : escape(seg).replace(/\*/g, '[^/]*') + '/'))
    .join('')
    .replace(/\/$/, '')
  return new RegExp(`^${body}$`)
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'generated' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p.split(path.sep).join('/'))
  }
  return out
}

const files = new Set()
for (const pattern of patterns) {
  const clean = pattern.replace(/^\.\//, '')
  const base = clean.split('/').slice(0, clean.split('/').findIndex((s) => s.includes('*')) >>> 0 || undefined)
  const baseDir = clean.includes('*') ? base.join('/') || '.' : path.dirname(clean)
  if (!fs.existsSync(baseDir)) continue
  const re = toRegExp(clean)
  for (const f of walk(baseDir)) if (re.test(f.replace(/^\.\//, ''))) files.add(f)
}

if (!files.size) {
  console.error(`run-tests: no files match ${patterns.join(' ')}`)
  process.exit(1)
}
const r = spawnSync(process.execPath, [...imports, '--test', ...[...files].sort()], { stdio: 'inherit' })
process.exit(r.status ?? 1)
