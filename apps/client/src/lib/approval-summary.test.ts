import assert from 'node:assert/strict'
import test from 'node:test'
import { approvalSummary, isOwnRequisition, type ApprovalRow } from './approval-summary'

const row = (type: string, context: Record<string, unknown> | null): ApprovalRow => ({ id: 'a', type, subjectId: 's', status: 'PENDING', context, createdAt: '2026-10-22T00:00:00Z' })

test('a credit increase says who, from what to what, and why', () => {
  const s = approvalSummary(row('CREDIT_LIMIT_INCREASE', { customerName: 'Mine Mart', currentLimit: 1000, requestedLimit: 5000, reason: 'Second store' }))
  assert.equal(s.title, 'Credit limit increase: Mine Mart')
  assert.equal(s.detail, '$1,000.00 to $5,000.00. Second store')
  assert.equal(approvalSummary(row('CREDIT_LIMIT_INCREASE', { customerName: 'X', requestedLimit: 300 })).detail, 'no limit to $300.00')
})

test('other types show an amount and a note when the request carries them', () => {
  assert.deepEqual(approvalSummary(row('PURCHASE_ORDER', { total: 1250.5, supplierName: 'Acme' })), { title: 'Purchase order', detail: '$1,250.50 · Acme' })
  assert.deepEqual(approvalSummary(row('DISCOUNT', null)), { title: 'Discount', detail: '' })
  assert.equal(approvalSummary(row('SOMETHING_NEW', {})).title, 'something new')
})

test('only a requisition raised by the viewer counts as their own (no approve / reject for them)', () => {
  const pr = { ...row('PURCHASE_REQUISITION', {}), requestedBy: 'u1' }
  assert.equal(isOwnRequisition(pr, 'u1'), true)
  assert.equal(isOwnRequisition(pr, 'u2'), false)
  assert.equal(isOwnRequisition(pr, undefined), false)
  assert.equal(isOwnRequisition({ ...row('PURCHASE_ORDER', {}), requestedBy: 'u1' }, 'u1'), false, 'other types unchanged')
})

test('a purchase requisition shows its number and exact decimal total', () => {
  const s = approvalSummary(row('PURCHASE_REQUISITION', { number: 'PR-1001', total: '4262.5', currency: 'USD', supplierName: 'Acme' }))
  assert.deepEqual(s, { title: 'Purchase requisition PR-1001', detail: '$4,262.50 · Acme' })
  assert.equal(approvalSummary(row('PURCHASE_REQUISITION', { number: 'PR-1002', total: '0.9999', currency: 'EUR' })).detail, '0.9999 EUR')
})
