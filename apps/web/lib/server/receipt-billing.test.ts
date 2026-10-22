import assert from 'node:assert/strict'
import test from 'node:test'
import { Prisma, VendorBillStatus } from '@/generated/prisma-purchasing'
import { deriveBillStatus } from './ap-bills'
import { billFailureReason, billReceivedGoods } from './po-receiving'
import { ApiError } from './session'

const noAudit = async () => ({}) as never

test('billReceivedGoods returns the bill that was created or refreshed', async () => {
  const calls: string[] = []
  const outcome = await billReceivedGoods('t1', 'po1', 'u1', {
    createBill: async (_tenantId, input) => {
      calls.push(input.purchaseOrderId)
      return { id: 'b1', billNumber: 'BILL-1001-1', totalAmount: '575.00' }
    },
    audit: noAudit,
  })
  assert.deepEqual(calls, ['po1'])
  assert.deepEqual(outcome, { bill: { id: 'b1', billNumber: 'BILL-1001-1', totalAmount: 575 }, billError: null })
})

test('billReceivedGoods never throws: the reason comes back and is written to the audit log', async () => {
  const audited: Array<{ action: string; entityId?: string; userId?: string; metadata?: Record<string, unknown> }> = []
  const outcome = await billReceivedGoods('t1', 'po1', 'u1', {
    createBill: async () => {
      throw new ApiError(400, 'No received quantities to bill')
    },
    audit: async (_tenantId, input) => {
      audited.push(input)
      return {} as never
    },
  })
  assert.deepEqual(outcome, { bill: null, billError: 'No received quantities to bill' })
  assert.equal(audited.length, 1)
  assert.equal(audited[0].action, 'ap.bill_creation_failed')
  assert.equal(audited[0].entityId, 'po1')
  assert.equal(audited[0].userId, 'u1')
  assert.deepEqual(audited[0].metadata, {
    reason: 'No received quantities to bill',
    detail: 'No received quantities to bill',
  })
})

test('database detail is never shown to the person receiving goods', () => {
  const internal = new Error('Invalid `purchasingDb.vendorBill.create()` invocation in /srv/app/ap-bills.ts:236')
  assert.equal(billFailureReason(internal), 'an unexpected error (details are in the audit log)')
  const duplicate = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on billNumber', {
    code: 'P2002',
    clientVersion: 'test',
  })
  assert.equal(billFailureReason(duplicate), 'another supplier bill already uses this bill number')
})

test('billReceivedGoods still reports the failure when the audit log is down too', async () => {
  const outcome = await billReceivedGoods('t1', 'po1', undefined, {
    createBill: async () => {
      throw new Error('ledger unavailable')
    },
    audit: async () => {
      throw new Error('tenant db unavailable')
    },
  })
  assert.deepEqual(outcome, { bill: null, billError: 'an unexpected error (details are in the audit log)' })
})

test('a $0 bill with nothing paid stays open instead of showing as Paid', () => {
  assert.equal(deriveBillStatus(0, 0, VendorBillStatus.ISSUED), 'ISSUED')
  assert.equal(deriveBillStatus(0, 0, VendorBillStatus.DRAFT), 'DRAFT')
  assert.equal(deriveBillStatus(0, 0, VendorBillStatus.VOID), 'VOID')
})

test('bill status for priced bills is unchanged', () => {
  assert.equal(deriveBillStatus(100, 0, VendorBillStatus.ISSUED), 'ISSUED')
  assert.equal(deriveBillStatus(100, 40, VendorBillStatus.ISSUED), 'PARTIALLY_PAID')
  assert.equal(deriveBillStatus(100, 100, VendorBillStatus.ISSUED), 'PAID')
})
