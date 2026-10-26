import assert from 'node:assert/strict'
import test from 'node:test'
import { hasClientPermission, requisitionActions, requisitionTotals, submissionProblems, type Requisition, type Viewer } from './requisitions'

const MANAGER_PERMS = ['purchasing.*', 'requisitions.*', 'approvals.*']

function req(over: Partial<Requisition> = {}): Requisition {
  return {
    id: 'r1',
    number: 'PR-1001',
    status: 'DRAFT',
    requestedBy: 'alice',
    supplierId: 's1',
    currency: 'USD',
    freightAmount: '12.5',
    dutyAmount: '0',
    otherLandedAmount: '0',
    notes: null,
    revision: 0,
    approvalRequestId: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectReason: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    purchaseOrderId: null,
    createdAt: '',
    updatedAt: '',
    lines: [{ lineNo: 1, skuCode: 'SKU-1', description: 'Widget', qtyRequested: 1000, unitCost: '4.25' }],
    ...over,
  }
}

const alice: Viewer = { userId: 'alice', role: 'MANAGER', permissions: MANAGER_PERMS }
const bob: Viewer = { userId: 'bob', role: 'MANAGER', permissions: MANAGER_PERMS }
const admin: Viewer = { userId: 'root', role: 'TENANT_ADMIN', permissions: ['*'] }
const accountant: Viewer = { userId: 'acc', role: 'ACCOUNTANT', permissions: ['purchasing.read', 'finance.*'] }
const pending = (over: Partial<Requisition> = {}) =>
  req({ status: 'PENDING_APPROVAL', approvalRequestId: 'ar1', approvalRequest: { id: 'ar1', status: 'PENDING', requestedBy: 'alice', decidedBy: null, decidedAt: null, rejectReason: null, cancelReason: null }, ...over })

test('permission matching follows the server', () => {
  assert.equal(hasClientPermission(alice, 'requisitions.write'), true)
  assert.equal(hasClientPermission(accountant, 'requisitions.read'), false)
  assert.equal(hasClientPermission(accountant, 'purchasing.read'), true)
  assert.equal(hasClientPermission(accountant, 'purchasing.write'), false)
  assert.equal(hasClientPermission({ role: 'TENANT_ADMIN', permissions: [] }, 'requisitions.write'), true)
  assert.equal(hasClientPermission(undefined, 'requisitions.read'), false)
})

test('only the requester edits and submits a draft or rejected requisition', () => {
  for (const status of ['DRAFT', 'REJECTED'] as const) {
    assert.equal(requisitionActions(req({ status }), alice).edit, true)
    assert.equal(requisitionActions(req({ status }), alice).submit, true)
    assert.equal(requisitionActions(req({ status }), bob).edit, false)
    assert.equal(requisitionActions(req({ status }), admin).submit, false, 'no submit on behalf, even for admins')
  }
  assert.equal(requisitionActions(pending(), alice).edit, false)
})

test('withdraw / cancel: the requester or an admin, never another manager', () => {
  const p = pending()
  assert.equal(requisitionActions(p, alice).withdraw, true)
  assert.equal(requisitionActions(p, admin).withdraw, true)
  assert.equal(requisitionActions(p, bob).withdraw, false)
  assert.equal(requisitionActions(p, bob).cancel, false)
  assert.equal(requisitionActions(req({ status: 'APPROVED', approvalRequestId: 'ar1' }), alice).withdraw, true)
  assert.equal(requisitionActions(req({ status: 'DRAFT' }), alice).withdraw, false)
  for (const status of ['CONVERTED', 'CANCELLED'] as const) assert.equal(requisitionActions(req({ status }), admin).cancel, false)
})

test('approve is for other approvers only; the requester is told why not', () => {
  assert.equal(requisitionActions(pending(), bob).decide, true)
  assert.equal(requisitionActions(pending(), admin).decide, true)
  const own = requisitionActions(pending(), alice)
  assert.equal(own.decide, false)
  assert.match(own.decideBlockedReason ?? '', /another manager/)
  assert.equal(requisitionActions(pending(), accountant).decide, false, 'not an approver role')
  const closed = pending({ approvalRequest: { id: 'ar1', status: 'CANCELLED', requestedBy: 'alice', decidedBy: null, decidedAt: null, rejectReason: null, cancelReason: 'x' } })
  assert.equal(requisitionActions(closed, bob).decide, false)
})

test('convert needs APPROVED and purchasing.write; open PO needs CONVERTED with a link', () => {
  const approved = req({ status: 'APPROVED' })
  assert.equal(requisitionActions(approved, bob).convert, true)
  assert.equal(requisitionActions(approved, accountant).convert, false)
  assert.equal(requisitionActions(pending(), bob).convert, false)
  assert.equal(requisitionActions(req({ status: 'CONVERTED', purchaseOrderId: 'po1' }), accountant).openPo, true)
  assert.equal(requisitionActions(req({ status: 'CONVERTED' }), bob).openPo, false)
})

test('totals are exact and unpriced lines are counted, not guessed', () => {
  const t = requisitionTotals(req({ lines: [
    { lineNo: 1, skuCode: null, description: 'a', qtyRequested: 3, unitCost: '0.3333' },
    { lineNo: 2, skuCode: null, description: 'b', qtyRequested: 2, unitCost: null },
  ], freightAmount: '0.1', dutyAmount: '0.2' }))
  assert.deepEqual(t, { lines: '0.9999', landed: '0.3', total: '1.2999', unpriced: 1 })
})

test('submission problems match the server rules', () => {
  assert.deepEqual(submissionProblems(req()), [])
  assert.deepEqual(submissionProblems(req({ supplierId: null, lines: [] })), ['Choose a supplier', 'Add at least one line'])
  assert.deepEqual(
    submissionProblems(req({ lines: [{ lineNo: 1, skuCode: null, description: 'x', qtyRequested: 0, unitCost: null }] })),
    ['Line 1: quantity must be more than 0', 'Line 1: enter a unit cost (0 is allowed)'],
  )
})
