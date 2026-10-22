import assert from 'node:assert/strict'
import test from 'node:test'
import { approvalSummary, type ApprovalRow } from './approval-summary'

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
