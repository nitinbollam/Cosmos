#!/usr/bin/env node
/** Remove stale Vite build artifacts accidentally copied into apps/client/public. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/client/public')
const assetsDir = path.join(publicDir, 'assets')
const staleIndex = path.join(publicDir, 'index.html')

let removed = 0
if (fs.existsSync(assetsDir)) {
  fs.rmSync(assetsDir, { recursive: true, force: true })
  removed++
  console.log('[clean] removed apps/client/public/assets/')
}
if (fs.existsSync(staleIndex)) {
  fs.unlinkSync(staleIndex)
  removed++
  console.log('[clean] removed apps/client/public/index.html (use apps/client/index.html)')
}
if (removed === 0) {
  console.log('[clean] apps/client/public already clean')
}
