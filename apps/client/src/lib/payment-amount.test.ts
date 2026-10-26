import assert from 'node:assert/strict'
import { test } from 'node:test'
import { submitCard } from './card-submit'
import { paymentAmountError } from './payment-amount'

const NOT_A_NUMBER = /must be a number/
const NOT_POSITIVE = /must be greater than zero/
const TOO_PRECISE = /at most 2 decimal places/

test('paymentAmountError rejects what the server rejects, with the same messages', () => {
  const cases: Array<[string, RegExp]> = [
    ['', NOT_A_NUMBER],
    ['   ', NOT_A_NUMBER],
    ['abc', NOT_A_NUMBER],
    ['10abc', NOT_A_NUMBER],
    ['1e2', NOT_A_NUMBER],
    ['$10', NOT_A_NUMBER],
    ['-10', NOT_POSITIVE],
    ['0', NOT_POSITIVE],
    ['0.00', NOT_POSITIVE],
    ['10.005', TOO_PRECISE],
    ['0.001', TOO_PRECISE],
    ['90', /Payment of \$90\.00 is more than the remaining balance of \$51\.04/],
    ['51.05', /more than the remaining balance of \$51\.04/],
  ]
  for (const [text, message] of cases) assert.match(paymentAmountError(text, 51.04) ?? '', message, JSON.stringify(text))
})

test('paymentAmountError accepts amounts up to the balance, to the cent', () => {
  for (const text of ['20', '20.5', '51.04', ' 51.04 ', '0.01']) assert.equal(paymentAmountError(text, 51.04), null, text)
  assert.equal(paymentAmountError('0.01', 0.01), null)
  assert.match(paymentAmountError('0.02', 0.01) ?? '', /remaining balance of \$0\.01/)
  assert.match(paymentAmountError('0.01', 0) ?? '', /remaining balance of \$0\.00/)
})

test('an invalid amount never reaches Stripe tokenization', async () => {
  let tokenized = 0
  let submitted = 0
  let shown: string | null = null
  const steps = (amount: string) => ({
    validate: () => paymentAmountError(amount, 51.04),
    createPaymentMethod: async () => {
      tokenized += 1
      return { paymentMethod: { id: 'pm_test' } }
    },
    onSubmit: () => {
      submitted += 1
    },
    setErr: (m: string | null) => {
      shown = m
    },
  })

  for (const amount of ['', 'abc', '10abc', '-10', '0', '10.005', '90']) {
    await submitCard(steps(amount))
    assert.ok(shown, `${JSON.stringify(amount)}: a message is shown`)
  }
  assert.equal(tokenized, 0)
  assert.equal(submitted, 0)

  // A valid amount goes through: tokenized once, submitted once, no message left behind.
  await submitCard(steps('20.00'))
  assert.equal(tokenized, 1)
  assert.equal(submitted, 1)
  assert.equal(shown, null)
})
