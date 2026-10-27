import test from 'node:test'
import assert from 'node:assert/strict'
import type { ToolResult } from './tools'
import { acceptSummary, buildSummaryMessages, cleanSummary, currencySupported, numbersSupported, shouldSummarize, withDeadline } from './record-summary'

const EVIDENCE = `### Vendor bills (AP) — outstanding
1 match.
Open balance across all 1 matches: **$575.00**.

| Bill # | Status | Supplier | Total | Balance | Due |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BILL-1001-1** | \`ISSUED\` | Pacific Supply Co. | $575.00 | $575.00 | Nov 7, 2026 |`

const records: ToolResult = { name: 'finance.bills', data: { rows: [{}], total: 1 }, links: [] }
const notice: ToolResult = { name: 'finance.bills', data: null, links: [], notice: "You don't have access" }
const ON = { modelConfigured: true, shareErpData: true, clarification: false }

test('summaries run only with a model, data approval and real records', () => {
  assert.equal(shouldSummarize([records], ON, {}), true)
  assert.equal(shouldSummarize([records], { ...ON, shareErpData: false }, {}), false)
  assert.equal(shouldSummarize([records], { ...ON, modelConfigured: false }, {}), false)
  assert.equal(shouldSummarize([records], { ...ON, clarification: true }, {}), false)
  assert.equal(shouldSummarize([notice], ON, {}), false)
  assert.equal(shouldSummarize([records], ON, { CELESTIAL_RECORD_SUMMARIES: 'false' }), false)
})

test('numbers in the summary must come from the evidence or question', () => {
  assert.equal(numbersSupported('You owe Pacific Supply $575 on BILL-1001-1, due Nov 7, 2026.', EVIDENCE), true)
  assert.equal(numbersSupported('One bill is outstanding for $575.00.', EVIDENCE), true)
  assert.equal(numbersSupported('You owe about $600.', EVIDENCE), false)
  assert.equal(numbersSupported('That is 3 bills.', EVIDENCE), false)
  assert.equal(numbersSupported('Bills from the last 30 days: one outstanding.', EVIDENCE, 'bills in the last 30 days'), true)
})

test('summaries with tables, headings or excess length are dropped', () => {
  assert.equal(cleanSummary('  One bill is outstanding.  '), 'One bill is outstanding.')
  assert.equal(cleanSummary('## Bills\nOne bill.'), null)
  assert.equal(cleanSummary('| a | b |\n| - | - |'), null)
  assert.equal(cleanSummary('x'.repeat(601)), null)
  assert.equal(cleanSummary(''), null)
})

test('acceptSummary combines format and number checks', () => {
  assert.equal(acceptSummary('You owe $575 to Pacific Supply Co.', EVIDENCE, 'how much do we owe'), 'You owe $575 to Pacific Supply Co.')
  assert.equal(acceptSummary('You owe $5,750 to Pacific Supply Co.', EVIDENCE, 'how much do we owe'), null)
})

test('the prompt carries the question and the exact evidence', () => {
  const [system, user] = buildSummaryMessages('which bills are outstanding?', EVIDENCE)
  assert.match(system.content, /Never add, estimate, round/)
  assert.match(user.content, /which bills are outstanding\?/)
  assert.ok(user.content.includes(EVIDENCE))
})

test('withDeadline returns null for slow or failed work', async () => {
  assert.equal(await withDeadline(Promise.resolve('ok'), 50), 'ok')
  assert.equal(await withDeadline(new Promise<string>(() => undefined), 20), null)
  assert.equal(await withDeadline(Promise.reject(new Error('x')), 50), null)
})

test('a currency the evidence never shows drops the summary', () => {
  const orders = '| **ORD-1001** | `DELIVERED` | Acme Retail Group | 124.95 | Oct 1, 2026 | 1 |'
  assert.equal(currencySupported('ORD-1001 was delivered, total 124.95.', orders), true)
  assert.equal(currencySupported('ORD-1001 was delivered, total $124.95.', orders), false)
  assert.equal(currencySupported('You owe $575.', EVIDENCE), true)
  assert.equal(acceptSummary('ORD-1001 totals $124.95.', orders, 'show orders'), null)
})

test('no AI summary above a one-line single answer', () => {
  const single: ToolResult = { name: 'sales.by_product', data: { rows: [{}], limit: 1 }, links: [] }
  assert.equal(shouldSummarize([single], ON, {}), false)
})
