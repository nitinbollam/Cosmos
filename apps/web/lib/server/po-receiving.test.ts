import assert from 'node:assert/strict'
import test from 'node:test'
import { PurchaseOrderStatus } from '@/generated/prisma-purchasing'
import { assertPoOpenForReceiving } from './po-receiving'
import { ApiError } from './session'

test('assertPoOpenForReceiving rejects draft and closed POs', () => {
  assert.throws(() => assertPoOpenForReceiving(PurchaseOrderStatus.DRAFT), ApiError)
  assert.throws(() => assertPoOpenForReceiving(PurchaseOrderStatus.CLOSED), ApiError)
  assert.doesNotThrow(() => assertPoOpenForReceiving(PurchaseOrderStatus.SUBMITTED))
  assert.doesNotThrow(() => assertPoOpenForReceiving(PurchaseOrderStatus.PARTIALLY_RECEIVED))
})
