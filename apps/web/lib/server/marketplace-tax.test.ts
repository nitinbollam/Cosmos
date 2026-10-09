import assert from 'node:assert/strict'
import test from 'node:test'
import { computeMarketplaceOrderTaxCents } from './marketplace-tax'

test('computeMarketplaceOrderTaxCents returns zero for empty subtotal', async () => {
  const result = await computeMarketplaceOrderTaxCents('tenant-x', 0)
  assert.equal(result.taxAmountCents, 0)
  assert.equal(result.taxJurisdiction, 'NONE')
})
