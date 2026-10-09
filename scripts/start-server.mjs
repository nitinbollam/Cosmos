#!/usr/bin/env node
/**
 * Production start: push Prisma schemas then boot the API server.
 * Set PLEROS_SKIP_DB_MIGRATE=1 to skip (e.g. local dev with pre-migrated DB).
 */
import { execSync } from 'node:child_process'
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

// Opt-in demo data for a fresh staging database: set PLEROS_SEED_DEMO=1, deploy once, then
// remove the variable. The seed upserts, so it never duplicates rows — but while the flag is on,
// every boot resets the demo records (passwords, stock levels) back to their seeded values.
if (process.env.PLEROS_SEED_DEMO === '1') {
  try {
    console.log('[start] PLEROS_SEED_DEMO=1 — seeding demo data (remove the variable after this deploy)…')
    execSync('npm run seed', { cwd: ROOT, stdio: 'inherit' })
  } catch (err) {
    // Demo data is a convenience; never block the app from starting because of it.
    console.error('[start] demo seed failed:', err)
  }
}

execSync('npx tsx apps/client/server/index.ts', { cwd: ROOT, stdio: 'inherit' })
