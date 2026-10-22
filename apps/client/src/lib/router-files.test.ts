import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every page the router loads must exist AND be tracked by git. A folder named `build/` is in
 * .gitignore, so a page under it passed every local check and then failed the deploy.
 */
test('every page the router imports exists and is not ignored by git', () => {
  const router = fs.readFileSync(path.join(src, 'router.tsx'), 'utf8')
  const files = [...router.matchAll(/import\('@\/([^']+)'\)/g)].map((m) => {
    const base = path.join(src, m[1])
    return [base + '.tsx', base + '.ts', path.join(base, 'index.tsx')].find((f) => fs.existsSync(f)) ?? base
  })
  assert.ok(files.length > 20, 'found the lazy page imports')
  const missing = files.filter((f) => !fs.existsSync(f))
  assert.deepEqual(missing, [], 'router imports a file that does not exist')
  const inGit = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: src, encoding: 'utf8' }).stdout.trim() === 'true'
  if (!inGit) return
  const ignored = files.filter((f) => spawnSync('git', ['check-ignore', '-q', f], { cwd: src }).status === 0)
  assert.deepEqual(ignored, [], 'router imports a file that .gitignore excludes, so it would not be deployed')
})
