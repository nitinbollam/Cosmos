import assert from 'node:assert/strict'
import test from 'node:test'
import { addToCart, cartPayload, cartTotal, creditLabel, creditRequestProblem, leadAction, money, overLimitBy, setQuantity, type CartLine, type CatalogItem } from './rep-app'

const item = (id: string, price: number): CatalogItem => ({ id, code: id.toUpperCase(), name: `Item ${id}`, listPrice: price, unitPrice: price, source: 'list' })

test('adding the same item twice raises its quantity', () => {
  let cart: CartLine[] = []
  cart = addToCart(cart, item('a', 2.5))
  cart = addToCart(cart, item('b', 1))
  cart = addToCart(cart, item('a', 2.5), 3)
  assert.equal(cart.length, 2)
  assert.equal(cart[0].quantity, 4)
})

test('quantity zero or junk removes the line, a number sets it', () => {
  const cart = addToCart(addToCart([], item('a', 1)), item('b', 1))
  assert.equal(setQuantity(cart, 'a', '5').find((l) => l.skuId === 'a')?.quantity, 5)
  assert.equal(setQuantity(cart, 'a', '0').length, 1)
  assert.equal(setQuantity(cart, 'a', '').length, 1)
  assert.equal(setQuantity(cart, 'a', 'x').length, 1)
  assert.equal(setQuantity(cart, 'a', '2.9').find((l) => l.skuId === 'a')?.quantity, 2)
})

test('the total is exact in cents and the payload carries no prices', () => {
  const cart = addToCart(addToCart([], item('a', 0.1), 3), item('b', 19.99), 2)
  assert.equal(cartTotal(cart), 40.28)
  assert.deepEqual(cartPayload(cart), [{ skuId: 'a', quantity: 3 }, { skuId: 'b', quantity: 2 }])
})

test('credit wording and the over-limit warning', () => {
  assert.equal(creditLabel({ creditLimit: null, openBalance: 0, availableCredit: null }), 'No credit limit set')
  assert.match(creditLabel({ creditLimit: 1000, openBalance: 250, availableCredit: 750 }), /\$750\.00 available of \$1,000\.00/)
  assert.match(creditLabel({ creditLimit: 1000, openBalance: 1200, availableCredit: -200 }), /\$200\.00 over limit/)
  assert.equal(overLimitBy({ creditLimit: 1000, openBalance: 250, availableCredit: 750 }, 700), 0)
  assert.equal(overLimitBy({ creditLimit: 1000, openBalance: 250, availableCredit: 750 }, 800.5), 50.5)
  assert.equal(overLimitBy({ creditLimit: null, openBalance: 0, availableCredit: null }, 9999), 0)
  assert.equal(money(null), '—')
})

test('what a rep can do with a lead', () => {
  assert.equal(leadAction({ status: 'NEW', assignedToUserId: null }, 'u1'), 'claim')
  assert.equal(leadAction({ status: 'NEW', assignedToUserId: 'u1' }, 'u1'), 'work')
  assert.equal(leadAction({ status: 'NEW', assignedToUserId: 'u2' }, 'u1'), 'taken')
  assert.equal(leadAction({ status: 'WON', assignedToUserId: 'u1' }, 'u1'), 'closed')
  assert.equal(leadAction({ status: 'LOST', assignedToUserId: null }, 'u1'), 'closed')
})

test('credit request checks match the server', () => {
  assert.equal(creditRequestProblem('5000', 'Opening a second store', 2000), null)
  assert.match(creditRequestProblem('', 'Opening a second store', null)!, /limit you want/)
  assert.match(creditRequestProblem('2000', 'Opening a second store', 2000)!, /above the current/)
  assert.match(creditRequestProblem('5000', 'ok', 2000)!, /why/)
})
