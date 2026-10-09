#!/usr/bin/env node
/**
 * Sets `provider = "sqlite" | "postgresql"` in every apps/web/prisma schema.prisma file.
 * Run before db:generate / db:migrate when PLEROS_DB_PROVIDER=postgres.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DB_BY_SCHEMA, getDbProvider } from './db-urls.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const prismaDir = path.join(root, 'apps', 'web', 'prisma')
const provider = getDbProvider()

for (const schemaName of Object.keys(DB_BY_SCHEMA)) {
  const schemaPath = path.join(prismaDir, schemaName, 'schema.prisma')
  if (!fs.existsSync(schemaPath)) continue
  const raw = fs.readFileSync(schemaPath, 'utf8')
  const next = raw.replace(/provider\s*=\s*"(sqlite|postgresql)"/, `provider = "${provider}"`)
  if (next !== raw) {
    fs.writeFileSync(schemaPath, next)
    console.log(`[prisma-provider] ${schemaName} -> ${provider}`)
  }
}

console.log(`[prisma-provider] All schemas set to ${provider}`)
