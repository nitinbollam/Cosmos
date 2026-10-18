import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const script = path.resolve(process.cwd(), '..', '..', 'scripts', 'check-code-health.mjs')

function run(files: Record<string, string>, extra: string[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-health-'))
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(dir, 'apps', 'web', 'lib', rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, body)
  }
  const r = spawnSync(process.execPath, [script, ...extra], { env: { ...process.env, CODE_HEALTH_ROOT: dir }, encoding: 'utf8' })
  fs.rmSync(dir, { recursive: true, force: true })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

test('each banned swallow pattern fails', () => {
  for (const body of [
    'work().catch(() => undefined)\n',
    'work().catch(() => null)\n',
    'work().catch(() => {})\n',
    'try { x() } catch {}\n',
    'try { x() } catch (e) {}\n',
    'work().catch((_e) => undefined)\n',
  ]) {
    const r = run({ 'a.ts': body })
    assert.equal(r.code, 1, body)
    assert.match(r.out, /swallow: apps\/web\/lib\/a\.ts has 1 \(baseline 0\)/)
  }
})

test('a swallow with a stated reason, a handled catch, and the helper all pass', () => {
  assert.equal(run({ 'a.ts': 'work().catch(() => undefined) // swallow-ok: best-effort cache warm\n' }).code, 0)
  assert.equal(run({ 'a.ts': 'work().catch((e) => console.error(e))\n' }).code, 0)
  assert.equal(run({ 'a.ts': "try { x() } catch (e) { console.error(e) }\n" }).code, 0)
  assert.equal(run({ 'a.ts': "fireAndForget('x', work())\n" }).code, 0)
  assert.equal(run({ 'a.ts': 'work().catch(() => undefined) // swallow-ok:\n' }).code, 1, 'a reason is required')
})

test('money patterns may not grow past the baseline, and --money=strict allows none', () => {
  const body = "const a = x.toFixed(2)\nconst b = new Prisma.Decimal(total)\nconst ok = new Prisma.Decimal('1.50')\nconst z = new Decimal(0)\n"
  const grown = run({ 'm.ts': body })
  assert.equal(grown.code, 1)
  assert.match(grown.out, /toFixed: apps\/web\/lib\/m\.ts has 1 \(baseline 0\)/)
  assert.match(grown.out, /decimalFromNumber: apps\/web\/lib\/m\.ts has 1 \(baseline 0\)/)
  const strict = run({ 'm.ts': body }, ['--money=strict'])
  assert.equal(strict.code, 1)
  assert.equal(run({ 'm.ts': 'const a = x.toFixed(2) // money-ok: display only\n' }, ['--money=strict']).code, 0)
})

test('tests and the money and helper modules are exempt', () => {
  assert.equal(run({ 'a.test.ts': 'work().catch(() => undefined)\n', 'money.ts': 'x.toFixed(2)\n', 'fire-and-forget.ts': 'p.catch(() => undefined)\n' }, ['--money=strict']).code, 0)
})
