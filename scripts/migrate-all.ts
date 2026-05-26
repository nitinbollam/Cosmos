/**
 * Push all @cosmos/web Prisma schemas to embedded SQLite files (no Postgres).
 */
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const { DB_BY_SCHEMA, envKeyForSchema, sqliteDatabaseUrl } = createRequire(__filename)('./db-urls.mjs') as {
  DB_BY_SCHEMA: Record<string, string>
  envKeyForSchema: (name: string) => string
  sqliteDatabaseUrl: (dbName: string, dataDir?: string) => string
}

const ROOT = path.resolve(__dirname, '..')
const WEB = path.join(ROOT, 'apps', 'web')
const PRISMA_DIR = path.join(WEB, 'prisma')
const dataDir = process.env.COSMOS_DATA_DIR ?? '.data'

mkdirSync(path.join(WEB, dataDir), { recursive: true })

for (const [name, dbName] of Object.entries(DB_BY_SCHEMA)) {
  const schema = path.join(PRISMA_DIR, name, 'schema.prisma')
  if (!existsSync(schema)) {
    console.log(`[skip] ${name}: no schema`)
    continue
  }
  const url = sqliteDatabaseUrl(dbName, dataDir)
  const envKey = envKeyForSchema(name)
  console.log(`\n[db push] ${name} -> ${url}`)
  execSync(`npx prisma db push --schema=${schema} --accept-data-loss`, {
    cwd: WEB,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, [envKey]: url },
  })
}

console.log('\nAll @cosmos/web SQLite schemas pushed.')
