#!/usr/bin/env node
/**
 * Production start: push Prisma schemas then boot the API server.
 * Set PLEROS_SKIP_DB_MIGRATE=1 to skip (e.g. local dev with pre-migrated DB).
 */
import { execFileSync, execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DB_BY_SCHEMA, databaseUrlForSchema, envKeyForSchema } from './db-urls.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The server reads one *_DATABASE_URL per domain (AUTH_, INVENTORY_, …) from the environment.
// db:migrate derives any that are missing (SQLite under apps/web/.data, or per-database
// Postgres URLs from DATABASE_URL), but the server didn't — so a deploy that only set
// DATABASE_URL (or nothing, for SQLite) booted and then failed every query. Derive them here,
// once, the same way, so migrate and server always agree. Explicit env vars still win.
for (const schema of Object.keys(DB_BY_SCHEMA)) {
  const key = envKeyForSchema(schema)
  if (!process.env[key]?.trim()) process.env[key] = databaseUrlForSchema(schema)
}

if (process.env.PLEROS_SKIP_DB_MIGRATE !== '1') {
  try {
    console.log('[start] running db:migrate…')
    execSync('npm run db:migrate', { cwd: ROOT, stdio: 'inherit' })
  } catch (err) {
    console.error('[start] db:migrate failed:', err)
    if (process.env.NODE_ENV === 'production') process.exit(1)
  }
}

// First admin / account recovery on a hosted database: set PLEROS_BOOTSTRAP_ADMIN_EMAIL and
// PLEROS_BOOTSTRAP_ADMIN_PASSWORD, deploy once, sign in, then remove both variables. Creates a
// platform SUPER_ADMIN, or resets that admin's password if it already exists.
const bootstrapEmail = process.env.PLEROS_BOOTSTRAP_ADMIN_EMAIL?.trim()
if (bootstrapEmail && process.env.PLEROS_BOOTSTRAP_ADMIN_PASSWORD?.trim()) {
  try {
    console.log(`[start] bootstrapping super admin ${bootstrapEmail} (remove PLEROS_BOOTSTRAP_ADMIN_* after this deploy)…`)
    // Invoked directly rather than through npm so the command line (and env) is never echoed.
    execFileSync(
      process.execPath,
      ['--import', './apps/web/server/register-paths.mjs', '--import', 'tsx', 'scripts/users.ts', 'bootstrap', '--email', bootstrapEmail],
      { cwd: ROOT, stdio: 'inherit' },
    )
  } catch (err) {
    console.error('[start] super admin bootstrap failed:', err instanceof Error ? err.message : err)
  }
}

execSync('npx tsx apps/client/server/index.ts', { cwd: ROOT, stdio: 'inherit' })
