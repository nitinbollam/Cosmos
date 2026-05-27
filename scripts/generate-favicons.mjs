#!/usr/bin/env node
/** Generate favicon PNGs from cosmos-logo.png for apps/client/public. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/client/public')
const logo = path.join(publicDir, 'cosmos-logo.png')

if (!fs.existsSync(logo)) {
  console.log('[favicon] skip — cosmos-logo.png missing')
  process.exit(0)
}

function sips(size: number, out: string) {
  const r = spawnSync('sips', ['-z', String(size), String(size), logo, '--out', out], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

sips(32, path.join(publicDir, 'favicon-32.png'))
sips(180, path.join(publicDir, 'apple-touch-icon.png'))
console.log('[favicon] apps/client/public/favicon-32.png + apple-touch-icon.png')
