import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ApprovalType } from '@/generated/prisma-tenant'
import { createApprovalRequest, decideApprovalRequest, getApprovalRequest } from './approvals'

const tenant = () => `t-${randomUUID()}`

async function poRequest(tenantId: string, requestedBy: string) {
  return createApprovalRequest(tenantId, { type: ApprovalType.PURCHASE_ORDER, subjectId: `po-${randomUUID()}`, requestedBy, context: { total: 5400 } })
}

test('the requester cannot approve their own request, and it stays pending', async () => {
  const tenantId = tenant()
  const req = await poRequest(tenantId, 'manager-a')
  await assert.rejects(
    decideApprovalRequest(tenantId, req.id, { approve: true, decidedBy: 'manager-a' }),
    (e: unknown) => (e as { status?: number }).status === 403 && /your own request/.test((e as Error).message),
  )
  assert.equal((await getApprovalRequest(tenantId, req.id)).status, 'PENDING')
})

test('another approver can approve it', async () => {
  const tenantId = tenant()
  const req = await poRequest(tenantId, 'manager-a')
  const decided = await decideApprovalRequest(tenantId, req.id, { approve: true, decidedBy: 'manager-b' })
  assert.equal(decided.status, 'APPROVED')
  assert.equal(decided.decidedBy, 'manager-b')
})

test('a requester may still withdraw their own request by rejecting it', async () => {
  const tenantId = tenant()
  const req = await poRequest(tenantId, 'manager-a')
  const decided = await decideApprovalRequest(tenantId, req.id, { approve: false, decidedBy: 'manager-a', rejectReason: 'Ordered by mistake' })
  assert.equal(decided.status, 'REJECTED')
})
