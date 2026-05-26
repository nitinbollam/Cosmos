#!/usr/bin/env node
/** Ensure apps/web/.data exists for embedded SQLite files (no Postgres, no Docker). */
import fs from 'node:fs'
import path from 'node:path'
import { WEB_ROOT } from './db-urls.mjs'

const dataDir = path.join(WEB_ROOT, '.data')
fs.mkdirSync(dataDir, { recursive: true })
console.log(`[db:setup] SQLite data directory ready: ${dataDir}`)
console.log('Next: npm run db:generate && npm run db:migrate && npm run seed')
