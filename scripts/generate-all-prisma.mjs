#!/usr/bin/env node
/**
 * Generates all Prisma clients for @cosmos/web (Next.js native API).
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webDir = path.join(root, 'apps', 'web')
const generatedDir = path.join(webDir, 'generated')

if (process.env.COSMOS_SKIP_PRISMA_GENERATE === '1') {
  console.log('[prisma] Skipped (COSMOS_SKIP_PRISMA_GENERATE=1).')
  process.exit(0)
}

function clientsLookGenerated() {
  const marker = path.join(generatedDir, 'prisma-auth', 'index.js')
  return fs.existsSync(marker)
}

function runGenerate() {
  execSync('npm run db:generate', { cwd: webDir, stdio: 'inherit' })
}

console.log('[prisma] Generating clients for @cosmos/web …')

const maxAttempts = 3
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    runGenerate()
    console.log('[prisma] Done.')
    break
  } catch (err) {
    const msg = String(err?.message ?? err)
    const locked = msg.includes('EPERM') || msg.includes('operation not permitted')
    if (!locked || attempt === maxAttempts) throw err
    console.warn(`[prisma] Engine file locked (attempt ${attempt}/${maxAttempts}). Retrying in 2s…`)
    console.warn('[prisma] Stop any running `npm run dev` process if this keeps failing.')
    await sleep(2000)
  }
}

if (!clientsLookGenerated()) {
  console.error('[prisma] Generate finished but clients are missing under apps/web/generated.')
  process.exit(1)
}
