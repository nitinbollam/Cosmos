#!/usr/bin/env node
/**
 * Run `prisma generate` with retries. Windows often returns EPERM when renaming the
 * query engine (AV scan, transient FS locks, or another Node process holding the DLL).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const schemaRel = process.argv[2]
if (!schemaRel) {
  console.error('usage: node prisma-generate-retry.mjs <schema-path-relative-to-cwd>')
  process.exit(1)
}

const cwd = process.cwd()
const win = process.platform === 'win32'
const localPrisma = win
  ? join(cwd, 'node_modules', '.bin', 'prisma.cmd')
  : join(cwd, 'node_modules', '.bin', 'prisma')

const max = Number(process.env.PRISMA_GENERATE_RETRIES ?? 4)
const delayMs = Number(process.env.PRISMA_GENERATE_RETRY_MS ?? 2500)

function runOnce() {
  if (existsSync(localPrisma)) {
    return spawnSync(localPrisma, ['generate', `--schema=${schemaRel}`], {
      cwd,
      stdio: 'inherit',
      shell: win,
    }).status
  }
  return spawnSync('npx', ['prisma', 'generate', `--schema=${schemaRel}`], {
    cwd,
    stdio: 'inherit',
    shell: win,
  }).status
}

for (let attempt = 1; attempt <= max; attempt++) {
  const code = runOnce()
  if (code === 0) process.exit(0)
  console.error(
    `prisma generate failed (attempt ${attempt}/${max}). On Windows EPERM often means the query engine DLL is locked — stop dev servers/tests for this service, then retry.`,
  )
  if (attempt < max) await delay(delayMs)
}

process.exit(1)
