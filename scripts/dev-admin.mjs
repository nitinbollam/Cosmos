#!/usr/bin/env node
/** @deprecated Use `npm run dev` or `npm run dev:web` — admin UI lives in apps/web. */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

console.warn('[dev:admin] Deprecated: starting @pleros/web instead (admin + shop + mobile PWA).')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const devWeb = path.join(root, 'scripts', 'dev-web.mjs')
const child = spawn(process.execPath, [devWeb], { cwd: root, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
