#!/usr/bin/env node
/**
 * Start local Postgres (docker compose) and print connection instructions.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

console.log('[db:setup:postgres] Starting docker compose postgres…')
const up = spawnSync('docker', ['compose', '-f', 'docker-compose.yml', 'up', '-d', 'postgres'], {
  cwd: root,
  stdio: 'inherit',
})
if (up.status !== 0) {
  console.error('Failed to start postgres container')
  process.exit(up.status ?? 1)
}

console.log(`
Postgres is running. Add to your root .env:

COSMOS_DB_PROVIDER=postgres
DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/postgres

Then create logical databases (once):
  docker compose -f docker-compose.yml exec -T postgres psql -U cosmos -d postgres < infra/sql/init-databases.sql

Then migrate and seed:
  npm run db:generate && npm run db:migrate && npm run seed
`)
