import test from 'node:test'
import assert from 'node:assert/strict'
import * as wmsReceiving from './wms-receiving'

test('resolveDefaultWarehouseId throws if tenant has no warehouse', async () => {
  // Verifies the warehouse resolution helper exists and throws on empty tenant
  await assert.rejects(
    async () => {
      await wmsReceiving.resolveDefaultWarehouseId('non-existent-tenant-99999')
    },
    {
      message: /No warehouse configured/i,
    },
  )
})
