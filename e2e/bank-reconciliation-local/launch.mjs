#!/usr/bin/env node
/**
 * Local bank-reconciliation demo on 16 disposable SQLite databases. See README.md in this folder.
 *
 *   BANKTEST_DEMO_PASSWORD=<synthetic> node e2e/bank-reconciliation-local/launch.mjs serve [--port 4417]
 *   BANKTEST_DEMO_PASSWORD=<synthetic> node e2e/bank-reconciliation-local/launch.mjs test  [--port 4417] [--screenshots <dir>]
 *
 * Creates a new pleros-bankrecon-demo-* folder in the OS temp directory, points every database URL
 * at it (refusing anything remote or inside apps/web/.data), loads the synthetic fixture, starts the
 * app server, and on exit stops the server and removes that folder only. apps/web/.data is hashed
 * before and after to prove it was not touched. Never uses db push, migrate, seed or the e2e global setup.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import {
  DEV_DATA_DIR,
  HERE,
  REPO_ROOT,
  WEB_ROOT,
  assertDisposableEnv,
  buildEnv,
  createTempDir,
  describeTargets,
  removeTempDir,
} from './disposable-env.mjs'

const USAGE = 'Usage: BANKTEST_DEMO_PASSWORD=<synthetic> node e2e/bank-reconciliation-local/launch.mjs <serve|test> [--port N] [--screenshots DIR]'

function parseArgs(argv) {
  const [mode, ...rest] = argv
  if (mode !== 'serve' && mode !== 'test') throw new Error(USAGE)
  const opts = { mode, port: 4417, screenshots: null }
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--port') opts.port = Number(rest[++i])
    else if (rest[i] === '--screenshots') opts.screenshots = path.resolve(rest[++i] ?? '')
    else throw new Error(`Unknown argument ${rest[i]}\n${USAGE}`)
  }
  if (!Number.isInteger(opts.port) || opts.port < 1024 || opts.port > 65535) throw new Error('--port must be 1024-65535')
  return opts
}

/** sha256 of every developer database, to prove the demo never touched them. */
function devDataHashes() {
  if (!fs.existsSync(DEV_DATA_DIR)) return {}
  return Object.fromEntries(
    fs
      .readdirSync(DEV_DATA_DIR)
      .filter((f) => f.endsWith('.db'))
      .sort()
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
      const res = await fetch(`${baseUrl}/api/v1/health`)
      if (res.ok) return
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
  const password = process.env.BANKTEST_DEMO_PASSWORD ?? ''
  if (password.length < 12) throw new Error('Set BANKTEST_DEMO_PASSWORD to a synthetic password of at least 12 characters (never a real one)')
  if (await portInUse(opts.port)) throw new Error(`Port ${opts.port} is already in use; refusing so the demo cannot talk to another server`)

  const before = devDataHashes()
  const tmp = createTempDir()
  const env = buildEnv(tmp, opts.port)
  let server = null
  let log = null
  let exitCode = 1
  try {
    const n = assertDisposableEnv(env, tmp)
    console.log(`[demo] provider=sqlite; ${n} database URLs, all disposable:`)
    for (const line of describeTargets(env, tmp)) console.log(`[demo]   ${line}`)
    console.log(`[demo] outbound-service keys blanked (plus ${env.BANKTEST_DEMO_EXTRA_BLANKED} more names from apps/web/.env.local)`)

    const fixture = spawnSync(
      process.execPath,
      ['--import', './server/register-paths.mjs', '--import', 'tsx', path.join(HERE, 'fixture.ts')],
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
    console.log(`[demo] app: ${env.BANKTEST_DEMO_BASE_URL}/admin/login  (users banktest-{accountant,preparer,admin,sales}@example.test)`)

    if (opts.mode === 'serve') {
      console.log('[demo] press Ctrl+C to stop; the temporary databases are then deleted')
      await new Promise((resolve) => {
        process.once('SIGINT', resolve)
        process.once('SIGTERM', resolve)
      })
      exitCode = 0
    } else {
      const shots = opts.screenshots ?? path.join(tmp, 'screenshots')
      const pw = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '-c', path.join(HERE, 'playwright.local.config.mts')],
        { cwd: REPO_ROOT, env: { ...env, BANKTEST_DEMO_SHOTS: shots }, stdio: 'inherit' },
      )
      exitCode = pw.status ?? 1
      console.log(`[demo] browser checks ${exitCode === 0 ? 'passed' : 'FAILED'}; screenshots: ${opts.screenshots ? shots : '<temp, deleted at exit>'}`)
    }
  } finally {
    stopServer(server)
    await new Promise((r) => setTimeout(r, 1500))
    if (log !== null) fs.closeSync(log)
    removeTempDir(tmp)
    const after = devDataHashes()
    const same = JSON.stringify(before) === JSON.stringify(after)
    console.log(`[demo] removed <os-temp>/${path.basename(tmp)}; apps/web/.data ${same ? 'unchanged' : 'CHANGED'} (${Object.keys(after).length} files hashed)`)
    if (!same) exitCode = 1
  }
  return exitCode
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[demo] ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  },
)
