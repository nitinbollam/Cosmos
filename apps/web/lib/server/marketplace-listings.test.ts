import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertListableSku,
  categoryIsAllowed,
  redactCounterpartyPayload,
} from './marketplace-listings'

test('tobacco SKU cannot be listed', () => {
  assert.throws(
    () =>
      assertListableSku({
        isTobacco: true,
        isAlcohol: false,
        ageRestricted: false,
        isRegulated: false,
        category: 'Electronics',
      }),
    /Regulated SKUs cannot be listed/,
  )
})

test('alcohol SKU cannot be listed', () => {
  assert.throws(
    () =>
      assertListableSku({
        isTobacco: false,
        isAlcohol: true,
        ageRestricted: false,
        isRegulated: false,
        category: 'Electronics',
      }),
    /Regulated SKUs cannot be listed/,
  )
})

test('age-restricted SKU cannot be listed', () => {
  assert.throws(
    () =>
      assertListableSku({
        isTobacco: false,
        isAlcohol: false,
        ageRestricted: true,
        isRegulated: false,
        category: 'Electronics',
      }),
    /Regulated SKUs cannot be listed/,
  )
})

test('regulated SKU cannot be listed', () => {
  assert.throws(
    () =>
      assertListableSku({
        isTobacco: false,
        isAlcohol: false,
        ageRestricted: false,
        isRegulated: true,
        category: 'Electronics',
      }),
    /Regulated SKUs cannot be listed/,
  )
})

test('non-allowlisted category cannot be listed', () => {
  assert.throws(
    () =>
      assertListableSku({
        isTobacco: false,
        isAlcohol: false,
        ageRestricted: false,
        isRegulated: false,
        category: 'Wine & Spirits',
      }),
    /not eligible for marketplace listing/,
  )
})

test('allowlisted category passes regulated flag check', () => {
  assert.doesNotThrow(() =>
    assertListableSku({
      isTobacco: false,
      isAlcohol: false,
      ageRestricted: false,
      isRegulated: false,
      category: 'Electronics',
    }),
  )
  assert.equal(categoryIsAllowed('electronics'), true)
})

test('counterparty payload redacts real business identity fields', () => {
  const payload = redactCounterpartyPayload({
    id: 'listing-1',
    title: 'Widget',
    seller: { handle: 'seller-a1b2', ratingAvg: 4.5, ratingCount: 2, completedOrderCount: 1, joinedAt: '2026-01-01' },
    legalName: 'Acme Distributors LLC',
    businessName: 'Acme Distributors LLC',
    address: '123 Main St, Dallas TX',
    taxId: '12-3456789',
    email: 'ops@acme.example',
    tenantId: 'tenant-secret',
    sellerTenantId: 'tenant-secret',
    buyerTenantId: 'tenant-buyer-secret',
  })

  assert.equal(payload.title, 'Widget')
  assert.equal((payload.seller as { handle: string }).handle, 'seller-a1b2')
  assert.equal('legalName' in payload, false)
  assert.equal('businessName' in payload, false)
  assert.equal('address' in payload, false)
  assert.equal('taxId' in payload, false)
  assert.equal('email' in payload, false)
  assert.equal('tenantId' in payload, false)
  assert.equal('sellerTenantId' in payload, false)
  assert.equal('buyerTenantId' in payload, false)
})
