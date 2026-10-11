import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStopItems } from './route-stop-items'

const SKUS = new Map([
  ['pod', { id: 'pod', code: 'VAP-POD-001', name: 'Premium Nicotine Pod 5pk', isTobacco: true, ageRestricted: true, minimumAge: 21 }],
  ['cigar', { id: 'cigar', code: 'TOB-CIG-1', name: 'Cigarillo', isTobacco: true, ageRestricted: false, minimumAge: null }],
  ['chips', { id: 'chips', code: 'SNK-CHP-050', name: 'Spicy Chips Box', isTobacco: false, ageRestricted: false, minimumAge: null }],
])
const POLICY = { enabled: true, minimumAge: 21, requireDeliveryConfirmation: true }

test('buildStopItems lists products with quantities and no prices', () => {
  const r = buildStopItems([{ skuId: 'chips', quantity: 3 }], SKUS, POLICY)
  assert.deepEqual(r.items, [{ skuCode: 'SNK-CHP-050', name: 'Spicy Chips Box', quantity: 3, ageRestricted: false, minimumAge: null }])
  assert.equal(r.ageRestricted, false)
  assert.equal(r.ageCheckRequired, false)
})

test('buildStopItems tags age-restricted and tobacco products (tobacco uses the policy age)', () => {
  const r = buildStopItems([{ skuId: 'pod', quantity: 2 }, { skuId: 'cigar', quantity: 1 }, { skuId: 'chips', quantity: 1 }], SKUS, { ...POLICY, minimumAge: 18 })
  assert.deepEqual(r.items.map((i) => [i.skuCode, i.ageRestricted, i.minimumAge]), [['VAP-POD-001', true, 21], ['TOB-CIG-1', true, 18], ['SNK-CHP-050', false, null]])
  assert.equal(r.ageRestricted, true)
  assert.equal(r.minimumAge, 21)
  assert.equal(r.ageCheckRequired, true)
})

test('buildStopItems only requires the age check when the company policy enforces it', () => {
  const lines = [{ skuId: 'pod', quantity: 1 }]
  assert.equal(buildStopItems(lines, SKUS, { ...POLICY, enabled: false }).ageCheckRequired, false)
  assert.equal(buildStopItems(lines, SKUS, { ...POLICY, requireDeliveryConfirmation: false }).ageCheckRequired, false)
  assert.equal(buildStopItems(lines, SKUS, { ...POLICY, enabled: false }).ageRestricted, true)
})

test('buildStopItems merges repeated products and survives unknown SKUs', () => {
  const r = buildStopItems([{ skuId: 'chips', quantity: 1 }, { skuId: 'chips', quantity: 2 }, { skuId: 'gone', quantity: 1 }], SKUS, POLICY)
  assert.deepEqual(r.items.map((i) => [i.skuCode, i.quantity]), [['SNK-CHP-050', 3], ['gone', 1]])
  assert.equal(r.items[1].name, 'Unknown product')
})
