import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-inventory'
import { inventoryDb } from './db'
import { buildInventoryListPdf } from './inventory-document'

const tenant = () => `t-${randomUUID()}`
/** pdfkit writes one `/Type /Page` object per page (plus a `/Type /Pages` root). */
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length

async function seed(tenantId: string, n: number, category = 'Snacks') {
  const wh = await inventoryDb.warehouse.create({ data: { tenantId, name: 'Main', code: `WH-${randomUUID().slice(0, 4)}`, address: {} } })
  for (let i = 0; i < n; i++) {
    const sku = await inventoryDb.sKU.create({
      data: {
        tenantId,
        code: `SKU-${String(i).padStart(4, '0')}`,
        name: `Product ${i}`,
        category,
        cost: new Prisma.Decimal('2.50'),
        price: new Prisma.Decimal('4.00'),
        imageUrls: [],
        attributes: {},
      },
    })
    await inventoryDb.stockLevel.create({
      data: { tenantId, skuId: sku.id, warehouseId: wh.id, quantityOnHand: i, quantityAvailable: i },
    })
  }
  return wh
}

test('the inventory PDF is a real PDF and covers every row, not just the first page of the list', async () => {
  const tenantId = tenant()
  await seed(tenantId, 120)
  const pdf = await buildInventoryListPdf(tenantId, {})
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  assert.ok(pageCount(pdf) >= 3, `120 rows should take several pages, got ${pageCount(pdf)}`)
})

test('filters narrow the PDF, and an empty result still produces a one-page document', async () => {
  const tenantId = tenant()
  await seed(tenantId, 120)
  const filtered = await buildInventoryListPdf(tenantId, { search: 'SKU-0001' })
  assert.equal(pageCount(filtered), 1)
  const empty = await buildInventoryListPdf(tenantId, { category: 'Nothing here' })
  assert.equal(empty.subarray(0, 5).toString(), '%PDF-')
  assert.equal(pageCount(empty), 1)
})

test('an unknown warehouse filter is refused rather than exporting everything', async () => {
  await assert.rejects(buildInventoryListPdf(tenant(), { warehouseId: 'missing' }), /Warehouse not found/)
})
