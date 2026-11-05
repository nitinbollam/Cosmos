#!/usr/bin/env node
/**
 * Browser checks of buyer quote editing and withdrawal (Ticket #3, Phase 6) and of the admin quote page (Phase 7)
 * on 16 disposable SQLite databases.
 *
 *   node e2e/buyer-quote-local/launch.mjs test [--spec buyer|admin] [--port 4418] [--screenshots <dir outside the repo>]
 *
 * Reuses the bank-reconciliation demo's disposable environment (../bank-reconciliation-local/disposable-env.mjs):
 * a new folder in the OS temp directory holds all 16 databases, every outbound-service key is blanked, and every
 * name in apps/web/.env.local that could supply a database URL or credential is defined first, so the server's
 * .env.local loader (which only fills undefined keys) cannot override anything. On top of that the repository's
 * fail-closed test database guard (apps/web/server/test-db-guard.mjs) must pass before the fixture runs.
 * The synthetic users' password is random per run and never printed or stored outside the temp folder's process
 * environment. apps/web/.data is hashed before and after to prove it was not touched.
 * Never uses db push, migrate, seed or the e2e global setup.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEV_DATA_DIR,
  REPO_ROOT,
  WEB_ROOT,
  assertDisposableEnv,
  buildEnv,
  createTempDir,
  describeTargets,
  generatedProvider,
  removeTempDir,
} from '../bank-reconciliation-local/disposable-env.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const [mode, ...rest] = argv
  if (mode !== 'test') throw new Error('Usage: node e2e/buyer-quote-local/launch.mjs test [--spec buyer|admin] [--port N] [--screenshots DIR]')
  const opts = { port: 4418, screenshots: null, spec: 'buyer' }
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--port') opts.port = Number(rest[++i])
    else if (rest[i] === '--spec') opts.spec = rest[++i]
    else if (rest[i] === '--screenshots') opts.screenshots = path.resolve(rest[++i] ?? '')
    else throw new Error(`Unknown argument ${rest[i]}`)
  }
  if (opts.spec !== 'buyer' && opts.spec !== 'admin') throw new Error('--spec must be buyer or admin')
  if (!Number.isInteger(opts.port) || opts.port < 1024 || opts.port > 65535) throw new Error('--port must be 1024-65535')
  return opts
}

function devDataHashes() {
  if (!fs.existsSync(DEV_DATA_DIR)) return {}
  return Object.fromEntries(
    fs
      .readdirSync(DEV_DATA_DIR)
      .sort()
      .filter((f) => fs.statSync(path.join(DEV_DATA_DIR, f)).isFile())
      .map((f) => [f, createHash('sha256').update(fs.readFileSync(path.join(DEV_DATA_DIR, f))).digest('hex')]),
  )
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => (socket.destroy(), resolve(true)))
    socket.once('error', () => resolve(false))
  })
}

async function waitForHealth(baseUrl, server, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error(`Server exited early (code ${server.exitCode}); see the server log`)
    try {
      if ((await fetch(`${baseUrl}/api/v1/health`)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('Server did not become healthy in time')
}

function stopServer(server) {
  if (!server || server.exitCode !== null) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
  else {
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch {
      server.kill('SIGTERM')
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (await portInUse(opts.port)) throw new Error(`Port ${opts.port} is already in use; refusing so the checks cannot talk to another server`)
  if (generatedProvider() !== 'sqlite') throw new Error('The Prisma clients are not generated for sqlite; refusing')
  if (opts.screenshots && path.relative(REPO_ROOT, opts.screenshots).split(path.sep)[0] !== '..') {
    throw new Error('--screenshots must be outside the repository')
  }

  const before = devDataHashes()
  const tmp = createTempDir()
  const env = {
    ...buildEnv(tmp, opts.port),
    // The repository's fail-closed test database guard checks the same 16 URLs against this folder.
    PLEROS_TEST_DB_DIR: tmp,
    QTEST_DEMO_PASSWORD: randomBytes(18).toString('base64url'),
  }
  let server = null
  let log = null
  let exitCode = 1
  try {
    const n = assertDisposableEnv(env, tmp)
    const guard = spawnSync(process.execPath, ['./server/test-db-guard.mjs'], { cwd: WEB_ROOT, env, stdio: 'inherit' })
    if (guard.status !== 0) throw new Error(`The test database guard refused (exit ${guard.status})`)
    console.log(`[qtest] ${n} database URLs, all disposable; test-db-guard passed:`)
    for (const line of describeTargets(env, tmp)) console.log(`[qtest]   ${line}`)

    const fixture = spawnSync(
      process.execPath,
      [
        '--import', './server/test-db-guard.mjs',
        '--import', './server/register-paths.mjs',
        '--import', './server/test-db-guard-after.mjs',
        '--import', 'tsx',
        path.join(HERE, 'fixture.ts'),
      ],
      { cwd: WEB_ROOT, env, stdio: 'inherit' },
    )
    if (fixture.status !== 0) throw new Error('Fixture failed')

    log = fs.openSync(path.join(tmp, 'server.log'), 'w')
    server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: path.join(REPO_ROOT, 'apps', 'client'),
      env,
      stdio: ['ignore', log, log],
      detached: process.platform !== 'win32',
    })
    await waitForHealth(env.BANKTEST_DEMO_BASE_URL, server)
    console.log(`[qtest] app up at ${env.BANKTEST_DEMO_BASE_URL}`)

    const shots = opts.screenshots ?? path.join(tmp, 'screenshots')
    fs.mkdirSync(shots, { recursive: true })
    const pw = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '-c', path.join(HERE, 'playwright.local.config.mts')],
      { cwd: REPO_ROOT, env: { ...env, QTEST_SHOTS: shots, QTEST_SPEC: opts.spec }, stdio: 'inherit' },
    )
    exitCode = pw.status ?? 1
    console.log(`[qtest] browser checks ${exitCode === 0 ? 'passed' : 'FAILED'}; screenshots: ${opts.screenshots ? shots : '<temp, deleted at exit>'}`)
    if (exitCode !== 0 && opts.screenshots) fs.copyFileSync(path.join(tmp, 'server.log'), path.join(shots, 'server.log'))
  } finally {
    stopServer(server)
    await new Promise((r) => setTimeout(r, 1500))
    if (log !== null) fs.closeSync(log)
    removeTempDir(tmp)
    const after = devDataHashes()
    const same = JSON.stringify(before) === JSON.stringify(after)
    console.log(`[qtest] removed <os-temp>/${path.basename(tmp)}; apps/web/.data ${same ? 'unchanged' : 'CHANGED'} (${Object.keys(after).length} files hashed)`)
    if (!same) exitCode = 1
  }
  return exitCode
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[qtest] ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  },
)
