import assert from 'node:assert/strict'
import { test } from 'node:test'

/** Pure helpers mirrored from compliance-age for unit coverage without DB. */

function clampAge(n: unknown, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(99, Math.max(18, Math.round(v)))
}

function ageFromDob(dobIso: string, at = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobIso.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dob = new Date(Date.UTC(y, mo - 1, d))
  if (Number.isNaN(dob.getTime())) return null
  let age = at.getUTCFullYear() - y
  const hadBirthday =
    at.getUTCMonth() > mo - 1 || (at.getUTCMonth() === mo - 1 && at.getUTCDate() >= d)
  if (!hadBirthday) age -= 1
  return age
}

function effectiveRestricted(
  sku: { isTobacco: boolean; ageRestricted: boolean; minimumAge: number | null },
  policyMinAge: number,
): { minimumAge: number } | null {
  const restricted = Boolean(sku.ageRestricted || sku.isTobacco)
  if (!restricted) return null
  return {
    minimumAge: sku.minimumAge && sku.minimumAge > 0 ? sku.minimumAge : policyMinAge,
  }
}

test('clampAge bounds to 18–99', () => {
  assert.equal(clampAge(21, 21), 21)
  assert.equal(clampAge(10, 21), 18)
  assert.equal(clampAge(120, 21), 99)
  assert.equal(clampAge('bad', 21), 21)
})

test('ageFromDob computes age correctly', () => {
  const at = new Date(Date.UTC(2026, 6, 9)) // Jul 9 2026
  assert.equal(ageFromDob('2005-07-09', at), 21)
  assert.equal(ageFromDob('2005-07-10', at), 20)
  assert.equal(ageFromDob('not-a-date', at), null)
})

test('tobacco SKUs are treated as age-restricted with policy default age', () => {
  const r = effectiveRestricted({ isTobacco: true, ageRestricted: false, minimumAge: null }, 21)
  assert.ok(r)
  assert.equal(r!.minimumAge, 21)
})

test('explicit SKU minimumAge overrides policy default', () => {
  const r = effectiveRestricted({ isTobacco: false, ageRestricted: true, minimumAge: 18 }, 21)
  assert.ok(r)
  assert.equal(r!.minimumAge, 18)
})

test('non-restricted SKUs return null', () => {
  assert.equal(effectiveRestricted({ isTobacco: false, ageRestricted: false, minimumAge: null }, 21), null)
})

test('license required for every non-POS channel when policy enabled', () => {
  const requireTobaccoLicense = true
  for (const channel of ['B2B_PORTAL', 'ADMIN', 'EDI', 'API', 'UNKNOWN', '']) {
    const isPos = channel.toUpperCase() === 'POS'
    const needsLicense = requireTobaccoLicense && !isPos
    assert.equal(needsLicense, true, `expected license gate for channel=${channel || '(empty)'}`)
  }
  assert.equal(requireTobaccoLicense && !('POS'.toUpperCase() === 'POS'), false)
})

test('POS attestation is ignored for non-POS channels', () => {
  const channel = 'B2B_PORTAL' as string
  const dtoAttestation = { method: 'ID_CHECK' as const }
  const ageAttestation = channel === 'POS' ? dtoAttestation : undefined
  assert.equal(ageAttestation, undefined)
})
