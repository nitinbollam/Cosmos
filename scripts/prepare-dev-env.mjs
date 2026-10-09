#!/usr/bin/env node
/**
 * Writes apps/web/.env.local from the repo root .env (embedded SQLite *_DATABASE_URL values).
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DB_BY_SCHEMA, databaseUrlForSchema, getDbProvider } from './db-urls.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootEnvPath = path.join(root, '.env')
const examplePath = path.join(root, '.env.example')
const webEnvPath = path.join(root, 'apps', 'web', '.env.local')
const webExamplePath = path.join(root, 'apps', 'web', '.env.local.example')
const clientEnvPath = path.join(root, 'apps', 'client', '.env')

if (!fs.existsSync(rootEnvPath) && fs.existsSync(examplePath)) {
  fs.copyFileSync(examplePath, rootEnvPath)
  console.log('Created .env from .env.example')
}

if (!fs.existsSync(rootEnvPath)) {
  console.error('Missing root .env — copy .env.example to .env first')
  process.exit(1)
}

const raw = fs.readFileSync(rootEnvPath, 'utf8')
const baseVars = Object.fromEntries(
  raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null
    })
    .filter(Boolean),
)

const dataDir = baseVars.PLEROS_DATA_DIR ?? '.data'

const webVars = {
  ...baseVars,
  PLEROS_DATA_DIR: dataDir,
  NEXT_PUBLIC_GATEWAY_URL: '/api/v1',
  NEXT_PUBLIC_WEB_ADMIN_ORIGIN: baseVars.NEXT_PUBLIC_WEB_ADMIN_ORIGIN ?? 'http://localhost:4000',
  PLEROS_CLIENT_ORIGIN: baseVars.PLEROS_CLIENT_ORIGIN ?? 'http://localhost:4000',
}

const dbProvider = baseVars.PLEROS_DB_PROVIDER ?? ''
if (dbProvider === 'postgres') {
  webVars.PLEROS_DB_PROVIDER = 'postgres'
  if (!webVars.DATABASE_URL) {
    webVars.DATABASE_URL = baseVars.DATABASE_URL ?? 'postgresql://pleros:pleros@localhost:5432/postgres'
  }
}

for (const [schema] of Object.entries(DB_BY_SCHEMA)) {
  const envKey = `${schema.toUpperCase()}_DATABASE_URL`
  webVars[envKey] =
    baseVars[envKey] ??
    databaseUrlForSchema(schema, { dataDir })
}

const exampleLines = fs.existsSync(webExamplePath) ? fs.readFileSync(webExamplePath, 'utf8') : ''
const orderedKeys = [
  'PLEROS_DATA_DIR',
  'NEXT_PUBLIC_GATEWAY_URL',
  ...Object.keys(DB_BY_SCHEMA).map((s) => `${s.toUpperCase()}_DATABASE_URL`),
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_RETURN_URL',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_WEB_ADMIN_ORIGIN',
]

const lines = []
for (const key of orderedKeys) {
  if (webVars[key] != null && webVars[key] !== '') lines.push(`${key}=${webVars[key]}`)
}
for (const [k, v] of Object.entries(webVars)) {
  if (!orderedKeys.includes(k) && !k.startsWith('AUTH_SERVICE') && !k.endsWith('_SERVICE_URL')) {
    lines.push(`${k}=${v}`)
  }
}
if (exampleLines.includes('# Legacy')) {
  lines.push('')
  lines.push('# Legacy Nest URLs not used by @pleros/web')
}

fs.writeFileSync(webEnvPath, `${lines.join('\n')}\n`)
const mode = webVars.PLEROS_DB_PROVIDER === 'postgres' ? 'Postgres' : `SQLite in apps/web/${dataDir}`
console.log(`[env] apps/web/.env.local (${lines.length} vars, ${mode})`)

const clientEnv = [
  `VITE_GATEWAY_URL=${baseVars.VITE_GATEWAY_URL ?? '/api/v1'}`,
  `VITE_WEB_ADMIN_ORIGIN=${webVars.NEXT_PUBLIC_WEB_ADMIN_ORIGIN}`,
  `VITE_STRIPE_PUBLISHABLE_KEY=${baseVars.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? baseVars.STRIPE_PUBLISHABLE_KEY ?? ''}`,
].join('\n')
fs.writeFileSync(clientEnvPath, `${clientEnv}\n`)
console.log('[env] apps/client/.env')

spawnSync(process.execPath, [path.join(root, 'scripts', 'clean-client-public.mjs')], {
  cwd: root,
  stdio: 'inherit',
})
spawnSync(process.execPath, [path.join(root, 'scripts', 'generate-favicons.mjs')], {
  cwd: root,
  stdio: 'inherit',
})

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const ae = spawnSync(npm, ['run', 'build', '-w', '@pleros/analytics-engine'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (ae.status !== 0) process.exit(ae.status ?? 1)

console.log('Dev env ready (Vite UI + API on :4000).')
