#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const servicesDir = path.join(root, 'services')

const bootstrapBody = `import fs from 'node:fs'
import path from 'node:path'
import { bootstrapTelemetry } from '@cosmos/tracing'

/** Service cwd \`.env\` overrides monorepo root DATABASE_URL from turbo tooling. */
function preferLocalServiceEnv() {
  const envPath = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
}

preferLocalServiceEnv()
bootstrapTelemetry('SERVICE_NAME')
`

for (const svc of fs.readdirSync(servicesDir)) {
  const file = path.join(servicesDir, svc, 'src', 'tracing-bootstrap.ts')
  if (!fs.existsSync(file)) continue
  fs.writeFileSync(file, bootstrapBody.replace('SERVICE_NAME', svc))
  console.log(`updated ${svc}`)
}
