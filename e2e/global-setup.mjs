import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default async function globalSetup() {
  if (process.env.PLEROS_E2E_SKIP_DB) return

  execSync('node scripts/prepare-dev-env.mjs', { cwd: root, stdio: 'inherit' })
  try {
    execSync('npm run db:generate-all', { cwd: root, stdio: 'inherit', env: process.env })
  } catch {
    /* Windows file locks — ok if clients already exist */
  }
  execSync('npm run db:migrate', { cwd: root, stdio: 'inherit', env: process.env })
  execSync('npm run seed', { cwd: root, stdio: 'inherit', env: process.env })
}
