import assert from 'node:assert/strict'
import test from 'node:test'
import { deliverNotification } from './notification-provider'
import { webhookSigningSecret } from './webhooks'

const PROVIDER_ENV = ['SENDGRID_API_KEY', 'TWILIO_ACCOUNT_SID', 'NOTIFICATION_WEBHOOK_URL'] as const

/** Run `fn` with the given env overrides (undefined = unset) and every console line captured. */
async function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(overrides).map((k) => [k, process.env[k]]))
  const lines: string[] = []
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error }
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    console[level] = (...args: unknown[]) => void lines.push(args.map(String).join(' '))
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    await fn()
  } finally {
    Object.assign(console, original)
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  return lines
}

const noProviders = Object.fromEntries(PROVIDER_ENV.map((k) => [k, undefined]))
const resetEmail = {
  tenantId: 't1',
  channel: 'EMAIL' as const,
  recipient: 'user@example.com',
  templateKey: 'auth.password_reset',
  payload: { resetUrl: 'https://app.example.test/reset-password?token=SECRET-TOKEN', firstName: 'U' },
}

test('in production, an email with no provider is refused and the reset link never reaches the logs', async () => {
  const lines = await withEnv({ ...noProviders, NODE_ENV: 'production' }, async () => {
    await assert.rejects(deliverNotification(resetEmail), /No EMAIL provider configured/)
  })
  assert.ok(lines.length > 0, 'the failure is logged')
  assert.ok(!lines.some((l) => l.includes('SECRET-TOKEN')), lines.join('\n'))
})

test('in development the console fallback still prints the message', async () => {
  const lines = await withEnv({ ...noProviders, NODE_ENV: 'development' }, async () => {
    const res = await deliverNotification(resetEmail)
    assert.equal(res.provider, 'console')
  })
  assert.ok(lines.some((l) => l.includes('SECRET-TOKEN')))
})

test('webhook signing has no public default in production', async () => {
  await withEnv({ WEBHOOK_SIGNING_SECRET: undefined, NODE_ENV: 'production' }, async () => {
    assert.throws(() => webhookSigningSecret('t1'), /WEBHOOK_SIGNING_SECRET/)
  })
  await withEnv({ WEBHOOK_SIGNING_SECRET: 's3cret', NODE_ENV: 'production' }, async () => {
    assert.equal(webhookSigningSecret('t1'), 's3cret:t1')
  })
})
