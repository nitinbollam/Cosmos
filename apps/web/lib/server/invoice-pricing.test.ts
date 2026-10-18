import assert from 'node:assert/strict'
import test from 'node:test'
import { Prisma } from '@/generated/prisma-order'
import {
  allocateShipmentTax,
  inferLegacyInvoiced,
  lineSubtotal,
  priceShipment,
  type BillableLine,
} from './invoice-pricing'
import { ApiError } from './session'

const D = (v: string | number) => new Prisma.Decimal(v)
const line = (id: string, skuId: string, quantity: number, price: string, invoiced = 0): BillableLine => ({
  id,
  skuId,
  quantity,
  quantityInvoiced: invoiced,
  unitPrice: D(price),
})

test('same SKU on two lines at different prices bills each unit at its own line price', () => {
  const lines = [line('l1', 'A', 10, '5.00'), line('l2', 'A', 10, '3.00')]
  const r = priceShipment(lines, [{ skuId: 'A', quantity: 20 }])
  assert.equal(r.subtotal.toFixed(2), '80.00')
})

test('partial shipments fill lines in order and never re-bill invoiced units', () => {
  const lines = [line('l1', 'A', 10, '5.00'), line('l2', 'A', 10, '3.00')]
  const first = priceShipment(lines, [{ skuId: 'A', quantity: 12 }])
  assert.equal(first.subtotal.toFixed(2), '56.00') // 10 x 5 + 2 x 3
  const after = lines.map((l) => ({
    ...l,
    quantityInvoiced: first.allocations.find((a) => a.lineId === l.id)?.quantity ?? 0,
  }))
  const second = priceShipment(after, [{ skuId: 'A', quantity: 8 }])
  assert.equal(second.subtotal.toFixed(2), '24.00') // 8 x 3
  assert.equal(first.subtotal.add(second.subtotal).toFixed(2), lineSubtotal(lines).toFixed(2))
})

test('an explicit lineId bills that line even when another line of the SKU comes first', () => {
  const lines = [line('l1', 'A', 5, '5.00'), line('l2', 'A', 5, '3.00')]
  const r = priceShipment(lines, [{ skuId: 'A', quantity: 5, lineId: 'l2' }])
  assert.equal(r.subtotal.toFixed(2), '15.00')
})

test('billing more units than remain is rejected with 409', () => {
  const lines = [line('l1', 'A', 5, '5.00', 4)]
  assert.throws(
    () => priceShipment(lines, [{ skuId: 'A', quantity: 2 }]),
    (e: unknown) => e instanceof ApiError && e.status === 409,
  )
})

test('tax across 3 shipments of 3 x $3.33 sums exactly to the order tax (0.27 + 0.27 + 0.28)', () => {
  const orderSubtotal = D('9.99')
  const orderTax = D('0.82')
  let taxSoFar = D(0)
  const parts: string[] = []
  for (let i = 0; i < 3; i++) {
    const t = allocateShipmentTax({
      orderSubtotal,
      orderTax,
      invoicedTaxSoFar: taxSoFar,
      shipmentSubtotal: D('3.33'),
      completesOrder: i === 2,
    })
    parts.push(t.toFixed(2))
    taxSoFar = taxSoFar.add(t)
  }
  assert.deepEqual(parts, ['0.27', '0.27', '0.28'])
  assert.equal(taxSoFar.toFixed(2), '0.82')
})

test('zero tax or zero subtotal yields zero tax', () => {
  assert.equal(
    allocateShipmentTax({
      orderSubtotal: D('10'),
      orderTax: D(0),
      invoicedTaxSoFar: D(0),
      shipmentSubtotal: D('10'),
      completesOrder: true,
    }).toFixed(2),
    '0.00',
  )
})

test('legacy invoices are inferred from the invoiced subtotal', () => {
  const lines = [line('l1', 'A', 10, '5.00'), line('l2', 'A', 10, '3.00')]
  const out = inferLegacyInvoiced(lines, D('56.00'))
  assert.deepEqual(
    out.map((l) => l.quantityInvoiced),
    [10, 2],
  )
})

test('no float drift on awkward unit prices', () => {
  const lines = [line('l1', 'A', 3, '0.1'), line('l2', 'B', 7, '19.99')]
  const r = priceShipment(lines, [
    { skuId: 'A', quantity: 3 },
    { skuId: 'B', quantity: 7 },
  ])
  assert.equal(r.subtotal.toFixed(2), '140.23')
})
