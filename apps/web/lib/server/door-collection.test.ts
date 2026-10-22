import assert from 'node:assert/strict'
import test from 'node:test'
import { cashVarianceCents, collectionProblem, collectionsFromPod, dayCloseProblem, podCash, podWithCollection, type CollectionRecord } from './door-collection'

const rec = (over: Partial<CollectionRecord> = {}): CollectionRecord => ({ at: '2026-10-22T15:00:00Z', by: 'd1', orderId: 'o1', amount: '25.50', method: 'CASH', ...over })

test('a collection must be a real amount, cash or cheque, no more than is owed', () => {
  assert.equal(collectionProblem({ amountCents: 2550, method: 'CASH' }, 2550), null)
  assert.equal(collectionProblem({ amountCents: 1000, method: 'CHECK', reference: '1042' }, 2550), null)
  assert.match(collectionProblem({ amountCents: 0, method: 'CASH' }, 2550)!, /amount/)
  assert.match(collectionProblem({ amountCents: 10.5, method: 'CASH' }, 2550)!, /amount/)
  assert.match(collectionProblem({ amountCents: '25', method: 'CASH' }, 2550)!, /amount/)
  assert.match(collectionProblem({ amountCents: 100, method: 'CARD' }, 2550)!, /cash or a cheque/)
  assert.match(collectionProblem({ amountCents: 100, method: 'CHECK' }, 2550)!, /cheque number/)
  assert.match(collectionProblem({ amountCents: 100, method: 'CHECK', reference: '  ' }, 2550)!, /cheque number/)
  assert.match(collectionProblem({ amountCents: 100, method: 'CASH' }, 0)!, /already paid/)
  assert.match(collectionProblem({ amountCents: 2551, method: 'CASH' }, 2550)!, /more than/)
})

test('collections append to the pod and keep everything else', () => {
  const a = podWithCollection({ signature: 'x' }, rec())
  const b = podWithCollection(a, rec({ orderId: 'o2', amount: '5.00', method: 'CHECK', reference: '7' }))
  assert.equal(b.signature, 'x')
  assert.deepEqual(collectionsFromPod(b).map((c) => c.orderId), ['o1', 'o2'])
  assert.deepEqual(collectionsFromPod(null), [])
  assert.deepEqual(collectionsFromPod({ collections: 'nope' }), [])
})

test('a driver holds door collections and van cash sales, cash and cheques apart; terms sales are not cash', () => {
  const pod = {
    collections: [rec({ amount: '25.50' }), rec({ amount: '10.10', method: 'CHECK', reference: '9' })],
    vanSales: [
      { at: 'x', by: 'd1', orderId: 'v1', total: '100.00', paymentMethod: 'CASH', lines: [] },
      { at: 'x', by: 'd1', orderId: 'v2', total: '40.05', paymentMethod: 'NET_TERMS', lines: [] },
      { at: 'x', by: 'd1', orderId: 'v3', total: '0.10', paymentMethod: 'CHECK', lines: [] },
    ],
  }
  assert.deepEqual(podCash(pod), { cashCents: 12550, checkCents: 1020 })
  assert.deepEqual(podCash(null), { cashCents: 0, checkCents: 0 })
})

test('variance is counted less expected, and a difference needs a reason to close', () => {
  assert.equal(cashVarianceCents(10000, 9800), -200)
  assert.equal(cashVarianceCents(10000, 10050), 50)
  assert.equal(dayCloseProblem({ countedCents: 10000 }, 10000), null)
  assert.match(dayCloseProblem({ countedCents: 9800 }, 10000)!, /Say why/)
  assert.match(dayCloseProblem({ countedCents: 9800, note: 'ab' }, 10000)!, /Say why/)
  assert.equal(dayCloseProblem({ countedCents: 9800, note: 'Gave change to a customer' }, 10000), null)
  assert.match(dayCloseProblem({ countedCents: -1 }, 0)!, /counted/)
  assert.match(dayCloseProblem({ countedCents: 1.5 }, 0)!, /counted/)
})
