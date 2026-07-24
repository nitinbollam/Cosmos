import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('pwa-shell-routes.json lists warehouse, delivery, and sales shells', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'pwa-shell-routes.json'), 'utf8')) as {
    shellRoutes: string[]
    staticAssets: string[]
  }
  assert.ok(cfg.shellRoutes.includes('/m/warehouse'))
  assert.ok(cfg.shellRoutes.includes('/m/delivery'))
  assert.ok(cfg.shellRoutes.includes('/m/sales'))
  assert.ok(cfg.shellRoutes.includes('/m/login'))
  assert.ok(cfg.staticAssets.includes('/index.html'))
  assert.ok(cfg.staticAssets.includes('/manifest.webmanifest'))
})

test('public/sw.js uses shell-first navigation and SWR for API GETs', () => {
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8')
  assert.match(sw, /shellFirstNavigation/)
  assert.match(sw, /staleWhileRevalidate/)
  assert.match(sw, /pleros-shell-v3/)
  assert.match(sw, /isCacheableApiGet/)
  assert.match(sw, /\/m\/delivery/)
  assert.match(sw, /\/m\/sales/)
  assert.doesNotMatch(sw, /networkFirstNavigation/)
})

test('sw.js MOBILE_SHELL_ROUTES matches pwa-shell-routes.json', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'pwa-shell-routes.json'), 'utf8')) as {
    shellRoutes: string[]
  }
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8')
  for (const route of cfg.shellRoutes) {
    assert.ok(sw.includes(`'${route}'`) || sw.includes(`"${route}"`), `sw.js includes ${route}`)
  }
})
