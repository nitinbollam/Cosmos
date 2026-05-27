import assert from 'node:assert/strict'
import test from 'node:test'
import { deliverNotification } from './notification-provider'

test('deliverNotification uses console provider by default', async () => {
  const prev = process.env.NOTIFICATION_WEBHOOK_URL
  delete process.env.NOTIFICATION_WEBHOOK_URL
  try {
    const res = await deliverNotification({
      tenantId: 't1',
      channel: 'EMAIL',
      recipient: 'ops@example.com',
      templateKey: 'inventory.low_stock',
      payload: { skuCode: 'SKU-1', qtyOnHand: 3, reorderPoint: 10 },
    })
    assert.equal(res.provider, 'console')
    assert.match(res.body, /SKU-1/)
  } finally {
    if (prev != null) process.env.NOTIFICATION_WEBHOOK_URL = prev
    else delete process.env.NOTIFICATION_WEBHOOK_URL
  }
})
