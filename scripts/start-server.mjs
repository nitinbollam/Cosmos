#!/usr/bin/env node
/**
 * Production start: push Prisma schemas then boot the API server.
 * Set PLEROS_SKIP_DB_MIGRATE=1 to skip (e.g. local dev with pre-migrated DB).
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (process.env.PLEROS_SKIP_DB_MIGRATE !== '1') {
  try {
    console.log('[start] running db:migrate…')
    execSync('npm run db:migrate', { cwd: ROOT, stdio: 'inherit' })
  } catch (err) {
    console.error('[start] db:migrate failed:', err)
    if (process.env.NODE_ENV === 'production') process.exit(1)
  }
}

execSync('npx tsx apps/client/server/index.ts', { cwd: ROOT, stdio: 'inherit' })
