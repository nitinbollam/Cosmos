/**
 * Preflight: lint → test → build for @pleros/web and workspace deps.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const isWin = process.platform === 'win32'

for (const task of ['lint', 'test', 'build']) {
  const r = spawnSync(npm, ['run', task], {
    stdio: 'inherit',
    cwd: root,
    env: process.env,
    shell: isWin,
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
