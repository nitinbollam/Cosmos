/**
 * Technical preflight gate: lint → test → build for the entire monorepo (Turbo-aware).
 * Run from repo root: `pnpm prod:preflight`
 *
 * Organizational production sign-off (threat modeling, SOC2, penetration test, DR drill,
 * capacity planning, on-call rotations) stays outside this script — see MISSING.md § Path to production.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const turboArgs = ['exec', 'turbo', 'run', 'lint', 'test', 'build']
// Many parallel prisma generates on Windows often hit EPERM renaming query_engine DLLs (Defender / FS locks).
if (process.platform === 'win32') turboArgs.push('--concurrency', '2')

const r = spawnSync(pm, turboArgs, {
  stdio: 'inherit',
  cwd: root,
  env: process.env,
  shell: process.platform === 'win32',
})

const code = r.status
process.exit(code === null || code === undefined ? 1 : code)
