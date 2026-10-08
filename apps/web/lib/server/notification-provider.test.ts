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

test('order and invoice emails link straight to the record', async () => {
  const prevHook = process.env.NOTIFICATION_WEBHOOK_URL
  const prevUrl = process.env.APP_URL
  delete process.env.NOTIFICATION_WEBHOOK_URL
  process.env.APP_URL = 'https://app.example.test/'
  try {
    const created = await deliverNotification({
      tenantId: 't1',
      channel: 'EMAIL',
      recipient: 'buyer@example.com',
      templateKey: 'order.created',
      payload: { orderId: 'ord_abc12345xyz', total: '99.00' },
    })
    assert.match(created.body, /https:\/\/app\.example\.test\/orders\/ord_abc12345xyz/)
    assert.match(created.body, /#12345XYZ/)

    const shipped = await deliverNotification({
      tenantId: 't1',
      channel: 'EMAIL',
      recipient: 'buyer@example.com',
      templateKey: 'order.shipped',
      payload: { orderId: 'ord_abc12345xyz' },
    })
    assert.match(shipped.body, /https:\/\/app\.example\.test\/orders\/ord_abc12345xyz/)

    const invoice = await deliverNotification({
      tenantId: 't1',
      channel: 'EMAIL',
      recipient: 'buyer@example.com',
      templateKey: 'invoice.issued',
      payload: { invoiceId: 'inv_1', invoiceNumber: 'INV-1', total: '10.00' },
    })
    assert.match(invoice.body, /https:\/\/app\.example\.test\/invoices\/inv_1/)
  } finally {
    if (prevHook != null) process.env.NOTIFICATION_WEBHOOK_URL = prevHook
    else delete process.env.NOTIFICATION_WEBHOOK_URL
    if (prevUrl != null) process.env.APP_URL = prevUrl
    else delete process.env.APP_URL
  }
})
