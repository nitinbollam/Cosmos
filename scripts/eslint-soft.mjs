#!/usr/bin/env node
/**
 * Run ESLint when the package has a local eslint binary; otherwise no-op.
 * Cross-platform alternative to `eslint ... || true` (Windows `cmd.exe` has no `|| true`).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const cwd = process.cwd()
const ext = process.argv[2] ?? '.ts'
const binDir = join(cwd, 'node_modules', '.bin')
const localBin =
  process.platform === 'win32'
    ? join(binDir, 'eslint.cmd')
    : join(binDir, 'eslint')

if (existsSync(localBin)) {
  spawnSync(localBin, ['src', '--ext', ext], {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
}

process.exit(0)
