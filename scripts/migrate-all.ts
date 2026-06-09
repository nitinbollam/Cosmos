/**
 * Push all @cosmos/web Prisma schemas (SQLite local dev or Postgres production).
 */
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { DB_BY_SCHEMA, envKeyForSchema, databaseUrlForSchema, getDbProvider } = require('./db-urls.mjs') as {
  DB_BY_SCHEMA: Record<string, string>
  envKeyForSchema: (name: string) => string
  databaseUrlForSchema: (name: string, opts?: { dataDir?: string }) => string
  getDbProvider: () => 'sqlite' | 'postgresql'
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB = path.join(ROOT, 'apps', 'web')
const PRISMA_DIR = path.join(WEB, 'prisma')
const dataDir = process.env.COSMOS_DATA_DIR ?? '.data'
const provider = getDbProvider()

if (provider === 'sqlite') {
  mkdirSync(path.join(WEB, dataDir), { recursive: true })
} else {
  execSync('node scripts/apply-prisma-provider.mjs', { cwd: ROOT, stdio: 'inherit' })
}

for (const [name] of Object.entries(DB_BY_SCHEMA)) {
  const schema = path.join(PRISMA_DIR, name, 'schema.prisma')
  if (!existsSync(schema)) {
    console.log(`[skip] ${name}: no schema`)
    continue
  }
  const url = databaseUrlForSchema(name, { dataDir })
  const envKey = envKeyForSchema(name)
  console.log(`\n[db push] ${name} (${provider}) -> ${url}`)
  execSync(`npx prisma db push --schema=${schema} --accept-data-loss`, {
    cwd: WEB,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, [envKey]: url },
  })
}

console.log(`\nAll @cosmos/web schemas pushed (${provider}).`)
