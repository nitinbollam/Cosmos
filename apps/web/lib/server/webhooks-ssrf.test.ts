import assert from 'node:assert/strict'
import { createServer, type AddressInfo } from 'node:net'
import test from 'node:test'
import { guardedLookup, isBlockedAddress, type ResolveHost } from './safe-outbound'
import { assertSafeWebhookUrl, deliverWebhook } from './webhooks'

const PUBLIC = { address: '93.184.216.34', family: 4 }
const always =
  (...addresses: Array<{ address: string; family: number }>): ResolveHost =>
  async () =>
    addresses

test('internal, reserved and smuggled addresses are blocked; public ones are not', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '198.18.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a9fe:a9fe',
    'not-an-ip',
  ]) {
    assert.equal(isBlockedAddress(ip), true, ip)
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(ip), false, ip)
  }
})

test('webhook URLs must be https and must not name an internal address', async () => {
  for (const raw of [
    'http://8.8.8.8/hook',
    'https://100.64.0.1/hook',
    'https://198.18.0.1/hook',
    'https://[::1]/hook',
    'https://[::ffff:7f00:1]/hook',
    'https://localhost/hook',
    'https://api.internal/hook',
  ]) {
    await assert.rejects(assertSafeWebhookUrl(raw, always(PUBLIC)), { status: 400 }, raw)
  }
  await assert.rejects(
    assertSafeWebhookUrl('https://hook.example/x', always(PUBLIC, { address: '10.0.0.5', family: 4 })),
    { status: 400 },
  )
  const ok = await assertSafeWebhookUrl('https://hook.example/x', always(PUBLIC))
  assert.equal(ok.hostname, 'hook.example')
})

test('the connection lookup refuses internal addresses in both callback forms Node uses', async () => {
  const call = (resolve: ResolveHost, all: boolean) =>
    new Promise<{ err: Error | null; address: unknown; family?: number }>((done) =>
      guardedLookup(resolve)('hook.example', { all }, (err, address, family) => done({ err, address, family })),
    )

  const single = await call(always(PUBLIC), false)
  assert.equal(single.err, null)
  assert.equal(single.address, PUBLIC.address)
  assert.equal(single.family, 4)

  const list = await call(always(PUBLIC), true)
  assert.equal(list.err, null)
  assert.deepEqual(list.address, [PUBLIC])

  for (const all of [false, true]) {
    const blocked = await call(always(PUBLIC, { address: '127.0.0.1', family: 4 }), all)
    assert.match(String(blocked.err?.message), /private IP/)
  }
})

/** A local listener that records whether anything ever connected to it. */
async function tripwire() {
  let connections = 0
  const server = createServer((socket) => {
    connections++
    socket.destroy()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => connections,
    close: () => new Promise((r) => server.close(r)),
  }
}

test('a host that switches to an internal address after validation is never connected to', async () => {
  const wire = await tripwire()
  try {
    let lookups = 0
    const rebinding: ResolveHost = async () =>
      ++lookups === 1 ? [PUBLIC] : [{ address: '127.0.0.1', family: 4 }]

    const url = await assertSafeWebhookUrl(`https://rebind.example:${wire.port}/hook`, rebinding)
    await assert.rejects(deliverWebhook(url, {}, '{}', 2000, rebinding), /private IP/)
    assert.equal(wire.connections(), 0)
  } finally {
    await wire.close()
  }
})

test('delivery refuses an internal IP literal even without a DNS lookup', async () => {
  const wire = await tripwire()
  try {
    await assert.rejects(
      deliverWebhook(new URL(`https://127.0.0.1:${wire.port}/hook`), {}, '{}', 2000, always(PUBLIC)),
      /private IP/,
    )
    assert.equal(wire.connections(), 0)
  } finally {
    await wire.close()
  }
})
