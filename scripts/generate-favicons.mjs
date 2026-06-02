#!/usr/bin/env node
/** Generate favicon PNGs from cosmos-mark.svg for apps/client/public. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/client/public')
const markSvg = path.join(publicDir, 'cosmos-mark.svg')

if (!fs.existsSync(markSvg)) {
  console.log('[favicon] skip — cosmos-mark.svg missing')
  process.exit(0)
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const tmpDir = path.join(publicDir, '.favicon-tmp')
fs.mkdirSync(tmpDir, { recursive: true })
const qlOut = path.join(tmpDir, 'mark.png')

run('qlmanage', ['-t', '-s', '512', '-o', tmpDir, markSvg])
const generated = path.join(tmpDir, `${path.basename(markSvg)}.png`)
if (!fs.existsSync(generated)) {
  console.error('[favicon] qlmanage did not produce a PNG')
  process.exit(1)
}
fs.renameSync(generated, qlOut)

function sips(size, out) {
  run('sips', ['-z', String(size), String(size), qlOut, '--out', out])
}

sips(32, path.join(publicDir, 'favicon-32.png'))
sips(180, path.join(publicDir, 'apple-touch-icon.png'))
sips(512, path.join(publicDir, 'cosmos-icon-512.png'))

fs.rmSync(tmpDir, { recursive: true, force: true })
console.log('[favicon] favicon-32.png, apple-touch-icon.png, cosmos-icon-512.png')
