#!/usr/bin/env node
/**
 * Writes per-service .env files from the repo root .env so Nest ConfigModule
 * (cwd = service dir) and Prisma see JWT_SECRET, REDIS_URL, and the correct DATABASE_URL.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootEnvPath = path.join(root, '.env')
const examplePath = path.join(root, '.env.example')

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

const baseUrl = baseVars.DATABASE_URL ?? 'postgresql://cosmos:cosmos@127.0.0.1:15432/cosmos'

function dbUrlForService(serviceDirName) {
  const slug = serviceDirName.replace(/-service$/, '').replace(/-/g, '_')
  const dbName = `cosmos_${slug}`
  try {
    const u = new URL(baseUrl)
    u.pathname = `/${dbName}`
    return u.toString()
  } catch {
    return `${baseUrl.replace(/\/[^/]*$/, '')}/${dbName}`
  }
}

const servicesDir = path.join(root, 'services')
for (const svc of fs.readdirSync(servicesDir)) {
  const dir = path.join(servicesDir, svc)
  if (!fs.statSync(dir).isDirectory()) continue

  const schema = path.join(dir, 'src', 'prisma', 'schema.prisma')
  const envVars = { ...baseVars, SERVICE_NAME: svc }
  if (fs.existsSync(schema)) {
    envVars.DATABASE_URL = dbUrlForService(svc)
  }

  const lines = Object.entries(envVars).map(([k, v]) => `${k}=${v}`)
  fs.writeFileSync(path.join(dir, '.env'), `${lines.join('\n')}\n`)
  if (fs.existsSync(schema)) {
    console.log(`[env] ${svc} -> ${envVars.DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`)
  } else {
    console.log(`[env] ${svc} (service URLs only)`)
  }
}

for (const app of ['web-admin', 'web-storefront']) {
  const dir = path.join(root, 'apps', app)
  if (!fs.existsSync(dir)) continue
  const appVars = { ...baseVars }
  if (app === 'web-admin') {
    // Same-origin rewrite in next.config.mjs — avoids CORS "Network Error" in the browser.
    appVars.NEXT_PUBLIC_GATEWAY_URL = '/api/v1'
    delete appVars.CASHFLOW_SERVICE_URL
  }
  const lines = Object.entries(appVars).map(([k, v]) => `${k}=${v}`)
  fs.writeFileSync(path.join(dir, '.env'), `${lines.join('\n')}\n`)
  console.log(`[env] apps/${app}`)
}

console.log('Dev .env files ready.')

const ae = spawnSync('pnpm', ['--filter', '@cosmos/analytics-engine', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (ae.status !== 0) {
  process.exit(ae.status ?? 1)
}
