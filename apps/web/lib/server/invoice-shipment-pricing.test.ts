import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { crmDb, orderDb, tenantDb } from './db'
import { invoiceShipmentForOrder } from './invoices'

const tenantId = `t-${randomUUID()}`
let customerId = ''

before(async () => {
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `ship-${tenantId.slice(-8)}`, displayName: 'Pricing Co', settings: {}, metadata: {} },
  })
  customerId = (await crmDb.customer.create({ data: { tenantId, name: 'Buyer', email: 'b@buyer.test' } })).id
})

after(async () => {
  await orderDb.invoice.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
})

async function seedOrder(lines: Array<{ qty: number; price: string }>, tax: string) {
  const sub = lines.reduce((s, l) => s + l.qty * Number(l.price), 0)
  return orderDb.order.create({
    data: {
      tenantId,
      customerId,
      channel: 'B2B_PORTAL',
      paymentMethod: 'NET_TERMS',
      status: 'SHIPPED',
      taxAmount: tax,
      totalAmount: (sub + Number(tax)).toFixed(2),
      lineItems: {
        create: lines.map((l) => ({ skuId: 'SKU-A', warehouseId: 'wh-1', quantity: l.qty, unitPrice: l.price })),
      },
    },
  })
}

test('two lines of one SKU at different prices invoice $80, not $75', async () => {
  const order = await seedOrder(
    [
      { qty: 10, price: '5.00' },
      { qty: 10, price: '3.00' },
    ],
    '0',
  )
  const inv = await invoiceShipmentForOrder(tenantId, order.id, [{ skuId: 'SKU-A', quantity: 20 }])
  assert.equal(inv?.subtotal.toFixed(2), '80.00')
  assert.equal(inv?.totalAmount.toFixed(2), '80.00')
})

test('split shipments sum exactly to the order subtotal, tax and total', async () => {
  const order = await seedOrder(
    [
      { qty: 10, price: '5.00' },
      { qty: 10, price: '3.00' },
    ],
    '8.00',
  )
  await invoiceShipmentForOrder(tenantId, order.id, [{ skuId: 'SKU-A', quantity: 12 }])
  const final = await invoiceShipmentForOrder(tenantId, order.id, [{ skuId: 'SKU-A', quantity: 8 }])
  assert.equal(final?.subtotal.toFixed(2), '80.00')
  assert.equal(final?.taxAmount.toFixed(2), '8.00')
  assert.equal(final?.totalAmount.toFixed(2), '88.00')

  const lines = await orderDb.orderLineItem.findMany({ where: { orderId: order.id } })
  assert.ok(lines.every((l) => l.quantityInvoiced === l.quantity))
})

test('3 x $3.33 shipped one at a time bills tax 0.27 + 0.27 + 0.28', async () => {
  const order = await seedOrder([{ qty: 3, price: '3.33' }], '0.82')
  const taxes: string[] = []
  let prev = '0.00'
  for (let i = 0; i < 3; i++) {
    const inv = await invoiceShipmentForOrder(tenantId, order.id, [{ skuId: 'SKU-A', quantity: 1 }])
    const cum = inv!.taxAmount.toFixed(2)
    taxes.push((Number(cum) - Number(prev)).toFixed(2))
    prev = cum
  }
  assert.deepEqual(taxes, ['0.27', '0.27', '0.28'])
})

test('re-billing the same units is rejected instead of double invoicing', async () => {
  const order = await seedOrder([{ qty: 2, price: '4.00' }], '0')
  await invoiceShipmentForOrder(tenantId, order.id, [{ skuId: 'SKU-A', quantity: 2 }])
  await assert.rejects(() => invoiceShipmentForOrder(tenantId, order.id, [{ skuId: 'SKU-A', quantity: 2 }]))
})
