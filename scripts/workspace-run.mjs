#!/usr/bin/env node
/**
 * Run a script across @pleros/web workspace deps, then @pleros/web (replaces Turborepo).
 *
 *   node scripts/workspace-run.mjs build
 *   node scripts/workspace-run.mjs lint
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const task = process.argv[2]
if (!task) {
  console.error('Usage: node scripts/workspace-run.mjs <build|lint|test|typecheck>')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const isWin = process.platform === 'win32'

/** Build order: types first, then libs, then web. */
const WORKSPACES = [
  '@pleros/types',
  '@pleros/analytics-engine',
  '@pleros/ui',
  '@pleros/web-gateway-client',
  '@pleros/client',
  '@pleros/web',
]

/** Client typecheck resolves workspace packages via dist/*.d.ts — build libs first. */
const BUILD_BEFORE_TYPECHECK = [
  '@pleros/types',
  '@pleros/analytics-engine',
  '@pleros/ui',
  '@pleros/web-gateway-client',
]

function run(workspace, script) {
  console.log(`\n[workspace] ${workspace} → npm run ${script}`)
  const r = spawnSync(npm, ['run', script, '-w', workspace], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: isWin,
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (task === 'typecheck') {
  for (const ws of BUILD_BEFORE_TYPECHECK) {
    run(ws, 'build')
  }
}

for (const ws of WORKSPACES) {
  run(ws, task)
}

console.log(`\n[workspace] Done: ${task}`)
