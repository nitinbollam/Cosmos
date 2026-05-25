import fs from 'node:fs'
import path from 'node:path'
import { bootstrapTelemetry } from '@cosmos/tracing'

/** Service cwd `.env` overrides monorepo root DATABASE_URL from turbo tooling. */
function preferLocalServiceEnv() {
  const envPath = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
}

preferLocalServiceEnv()
bootstrapTelemetry('payment-service')
