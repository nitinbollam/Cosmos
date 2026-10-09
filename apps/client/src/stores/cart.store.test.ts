import assert from 'node:assert/strict'
import test from 'node:test'

const memory = new Map<string, string>()

function fakeToken(sub: string, tenantId = 't1'): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256' })}.${b64({ sub, tenantId })}.sig`
}

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  writable: true,
  value: {
    location: { pathname: '/catalog' },
    addEventListener: () => undefined,
    localStorage: {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    },
  },
})

const item = (skuId: string, quantity = 1) => ({
  skuId,
  skuName: skuId,
  skuCode: skuId,
  unitPrice: 10,
  quantity,
  warehouseId: 'w1',
})

function signIn(sub: string) {
  memory.set('pleros.shop.accessToken', fakeToken(sub))
}
function signOut() {
  memory.delete('pleros.shop.accessToken')
}
const settle = () => new Promise((r) => setTimeout(r, 0))

// One sequential story: the store and its active key are module state.
test('each buyer keeps their own cart across sign-out and sign-in', async () => {
  // A cart saved before carts were per user is adopted by the first buyer who signs in.
  memory.set('pleros-cart-v1', JSON.stringify({ state: { items: [item('LEGACY')] }, version: 0 }))
  signIn('alice')
  const { useCartStore, syncCartToSession } = await import('./cart.store')
  syncCartToSession()
  await settle()
  assert.deepEqual(useCartStore.getState().items.map((i) => i.skuId), ['LEGACY'])
  assert.equal(memory.has('pleros-cart-v1'), false)

  useCartStore.getState().addItem(item('A1', 2))
  assert.equal(useCartStore.getState().count(), 3)

  // Sign out: the visible cart empties, but Alice's cart is still saved.
  signOut()
  syncCartToSession()
  await settle()
  assert.equal(useCartStore.getState().count(), 0)
  assert.ok(memory.get('pleros-cart-v1:t1:alice')?.includes('A1'))

  // Bob on the same device never sees Alice's cart.
  signIn('bob')
  syncCartToSession()
  await settle()
  assert.equal(useCartStore.getState().count(), 0)
  useCartStore.getState().addItem(item('B1'))
  signOut()
  syncCartToSession()
  await settle()

  // Something added while signed out joins Alice's cart when she signs back in.
  useCartStore.getState().addItem(item('GUEST1'))
  signIn('alice')
  syncCartToSession()
  await settle()
  assert.deepEqual(
    useCartStore.getState().items.map((i) => i.skuId).sort(),
    ['A1', 'GUEST1', 'LEGACY'],
  )
  assert.equal(memory.has('pleros-cart-v1:guest'), false)
  assert.ok(memory.get('pleros-cart-v1:t1:bob')?.includes('B1'))
  assert.ok(!memory.get('pleros-cart-v1:t1:alice')?.includes('B1'))
})
