import assert from 'node:assert/strict'
import test from 'node:test'
import { deliverNotification } from './notification-provider'

test('deliverNotification includes invoice.issued template', async () => {
  const prev = process.env.NOTIFICATION_WEBHOOK_URL
  delete process.env.NOTIFICATION_WEBHOOK_URL
  try {
    const res = await deliverNotification({
      tenantId: 't1',
      channel: 'EMAIL',
      recipient: 'buyer@example.com',
      templateKey: 'invoice.issued',
      payload: { invoiceNumber: 'INV-123', total: '99.00', dueAt: '2026-06-01' },
    })
    assert.equal(res.provider, 'console')
    assert.match(res.subject, /INV-123/)
    assert.match(res.body, /99\.00/)
  } finally {
    if (prev != null) process.env.NOTIFICATION_WEBHOOK_URL = prev
    else delete process.env.NOTIFICATION_WEBHOOK_URL
  }
})

test('deliverNotification includes payment.received template', async () => {
  const prev = process.env.NOTIFICATION_WEBHOOK_URL
  delete process.env.NOTIFICATION_WEBHOOK_URL
  try {
    const res = await deliverNotification({
      tenantId: 't1',
      channel: 'EMAIL',
      recipient: 'buyer@example.com',
      templateKey: 'payment.received',
      payload: { amount: '50.00', invoiceNumber: 'INV-123' },
    })
    assert.match(res.body, /50\.00/)
  } finally {
    if (prev != null) process.env.NOTIFICATION_WEBHOOK_URL = prev
    else delete process.env.NOTIFICATION_WEBHOOK_URL
  }
})
