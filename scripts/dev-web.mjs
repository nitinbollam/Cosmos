#!/usr/bin/env node
/**
 * Unified Pleros web — native /api/v1 (no Turborepo).
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const npm = isWin ? 'npm.cmd' : 'npm'

const args = ['run', 'dev', '-w', '@pleros/web']

console.log('[dev:web] @pleros/web on :4000 (fully native /api/v1)…')
console.log('[dev:web]', npm, args.join(' '))

const child = spawn(npm, args, { cwd: root, stdio: 'inherit', shell: isWin })
child.on('exit', (code) => process.exit(code ?? 0))
