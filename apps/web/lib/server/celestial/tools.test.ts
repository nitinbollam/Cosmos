import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionUser } from '../session'
import { canUseTool, runTools, TOOL_PERMISSIONS } from './tools'

function staff(role: string, permissions: string[] = []): SessionUser {
  return { userId: 'u1', tenantId: 't1', role, email: 'x@example.com', permissions } as unknown as SessionUser
}

test('every tool declares a module permission', () => {
  for (const [name, perms] of Object.entries(TOOL_PERMISSIONS)) {
    assert.ok(perms.length > 0, `${name} has no permission`)
  }
})

test('warehouse staff can read stock but not AP bills or invoices', () => {
  const s = staff('WAREHOUSE_STAFF')
  assert.equal(canUseTool(s, 'inventory.stock'), true)
  assert.equal(canUseTool(s, 'purchasing.orders'), true)
  assert.equal(canUseTool(s, 'finance.bills'), false)
  assert.equal(canUseTool(s, 'list_my_invoices'), false)
  assert.equal(canUseTool(s, 'quotes.list'), false)
})

test('accountant can read AP bills', () => {
  assert.equal(canUseTool(staff('ACCOUNTANT'), 'finance.bills'), true)
})

test('custom permissions override role defaults', () => {
  const s = staff('MANAGER', ['celestial.chat', 'orders.read'])
  assert.equal(canUseTool(s, 'orders.list'), true)
  assert.equal(canUseTool(s, 'purchasing.orders'), false)
})

test('denied tools return an access notice without querying', async () => {
  const [result] = await runTools(['finance.bills'], { session: staff('WAREHOUSE_STAFF') })
  assert.equal(result.data, null)
  assert.match(result.notice ?? '', /don't have access to vendor bills/)
  assert.match(result.notice ?? '', /finance\.read/)
})

test('product search with no product named asks instead of inventing a term', async () => {
  const [result] = await runTools(['search_catalog'], { session: staff('MANAGER'), searchTokens: [] })
  assert.equal(result.data, null)
  assert.match(result.notice ?? '', /Which product/)
})

test('portal buyers can use no Celestial ERP tool', () => {
  const buyer = staff('STAFF')
  for (const name of Object.keys(TOOL_PERMISSIONS) as Array<keyof typeof TOOL_PERMISSIONS>) {
    assert.equal(canUseTool(buyer, name), false, name)
  }
})
