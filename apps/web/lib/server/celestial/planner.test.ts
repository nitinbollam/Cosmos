import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionUser } from '../session'
import { allowedPlannerTools, buildPlannerMessages, clarifyReply, describeLookup, parsePlan, planQuestion, routingDoubt, unsupportedReply } from './planner'
import { detectIntent } from './intent'
import { resetProviderCooldowns } from './llm'

const ADMIN = { userId: 'u', tenantId: 't', role: 'TENANT_ADMIN', email: 'a@x', permissions: [] } as unknown as SessionUser
const WAREHOUSE = { ...ADMIN, role: 'WAREHOUSE_STAFF' } as SessionUser
const ALL = allowedPlannerTools(ADMIN)
const ENV = { CELESTIAL_EXTERNAL_ROUTING_APPROVED: 'true', GROQ_API_KEY: 'k' }

function replying(content: string, delayMs = 0): typeof fetch {
  return (async (_u: unknown, init?: RequestInit) => {
    if (delayMs) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, delayMs)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new Error('aborted'))
        })
      })
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  }) as typeof fetch
}

test('the planner only sees tools the employee may use', () => {
  assert.ok(ALL.includes('finance.bills'))
  const wh = allowedPlannerTools(WAREHOUSE)
  assert.equal(wh.includes('finance.bills'), false)
  assert.equal(wh.includes('sales.forecast'), false)
  assert.ok(wh.includes('inventory.stock'))
  const [system] = buildPlannerMessages('q', wh)
  assert.doesNotMatch(system.content, /finance\.bills/)
})

test('parsePlan accepts a valid tool plan and validates fields', () => {
  const now = new Date('2026-10-27T00:00:00Z')
  const plan = parsePlan(
    'Sure: {"type":"tool","tool":"finance.bills","params":{"supplier":"Pacific Supply","outstanding":true,"billStatus":"bogus","period":"last quarter","extra":1}}',
    ALL,
    now,
  )
  assert.equal(plan?.type, 'tools')
  const intent = (plan as { calls: Array<Record<string, unknown>> }).calls[0]
  assert.deepEqual(intent.tools, ['finance.bills'])
  assert.equal(intent.supplier, 'Pacific Supply')
  assert.equal(intent.outstanding, true)
  assert.equal(intent.billStatus, undefined, 'unknown enum value dropped')
  assert.equal((intent.dateRange as { label: string }).label, 'Q3 2026')
  assert.equal('extra' in intent, false)
})

test('parsePlan rejects unknown or unauthorised tools, missing references and non-JSON', () => {
  assert.equal(parsePlan('{"type":"tool","tool":"drop_tables"}', ALL), null)
  assert.equal(parsePlan('{"type":"tool","tool":"finance.bills"}', allowedPlannerTools(WAREHOUSE)), null)
  assert.equal(parsePlan('{"type":"tool","tool":"orders.detail","params":{}}', ALL), null)
  assert.equal(parsePlan('I think you want bills', ALL), null)
  assert.deepEqual(parsePlan('{"type":"knowledge"}', ALL), { type: 'knowledge' })
  assert.deepEqual(parsePlan('{"type":"unsupported"}', ALL), { type: 'unsupported' })
})

test('planQuestion routes through the model and falls back on timeout', async () => {
  resetProviderCooldowns()
  const plan = await planQuestion('anything Pacific hasnt been paid for yet?', ADMIN, {
    env: ENV,
    fetch: replying('{"type":"tool","tool":"finance.bills","params":{"supplier":"Pacific","outstanding":true}}'),
  })
  assert.equal(plan?.type, 'tools')
  resetProviderCooldowns()
  const slow = await planQuestion('anything?', ADMIN, {
    env: { ...ENV, CELESTIAL_PLANNER_TIMEOUT_MS: '30' },
    fetch: replying('{"type":"knowledge"}', 500),
  })
  assert.equal(slow, null)
})

test('the unsupported reply is fixed text listing what the employee can look up', () => {
  const reply = unsupportedReply('what will the weather be on Friday?', WAREHOUSE)
  assert.match(reply, /^Pleros doesn't have data I can use to answer “what will the weather be on Friday\?”/)
  assert.match(reply, /stock levels/)
  assert.doesNotMatch(reply, /vendor bills|sales totals/)
  assert.equal(reply, unsupportedReply('what will the weather be on Friday?', WAREHOUSE))
})

test('multi-lookup plans keep separate settings per lookup and cap at 3', () => {
  const now = new Date('2026-10-27T00:00:00Z')
  const plan = parsePlan(
    JSON.stringify({
      type: 'tools',
      calls: [
        { tool: 'sales.summary', params: { period: 'this quarter' } },
        { tool: 'sales.summary', params: { period: 'last quarter' } },
        { tool: 'drop_tables', params: {} },
        { tool: 'list_warehouses' },
        { tool: 'list_low_stock' },
      ],
    }),
    ALL,
    now,
  )
  assert.equal(plan?.type, 'tools')
  const calls = (plan as { calls: Array<{ tools: string[]; dateRange?: { label: string } }> }).calls
  assert.deepEqual(calls.map((c) => [c.tools[0], c.dateRange?.label]), [
    ['sales.summary', 'Q4 2026'],
    ['sales.summary', 'Q3 2026'],
  ])
})

test('clarify plans become a server-written question with options', () => {
  const plan = parsePlan('{"type":"clarify","question":"Which balance do you mean?","options":["Customer invoices (money owed to you)","Supplier bills (money you owe)"]}', ALL)
  assert.equal(plan?.type, 'clarify')
  assert.equal(
    clarifyReply(plan as { question: string; options: string[] }),
    'Which balance do you mean?\n\n- Customer invoices (money owed to you)\n- Supplier bills (money you owe)',
  )
  assert.equal(parsePlan('{"type":"clarify","question":"Which?","options":["only one"]}', ALL), null)
})

test('the router sees earlier lookups, not records', () => {
  const [system] = buildPlannerMessages('and last month?', ALL, [
    { question: 'which vendor bills are outstanding?', lookups: describeLookup('finance.bills', { outstanding: true, supplier: 'Pacific', dateRange: { label: 'this month' } }) },
  ])
  assert.match(system.content, /Asked: "which vendor bills are outstanding\?" → finance\.bills\(outstanding=true, supplier=Pacific, period=this month\)/)
  assert.match(system.content, /repeat that lookup with the change applied/)
})

test('routingDoubt: confident keyword matches skip the AI, unsure ones go to it', () => {
  const kw = (q: string) => detectIntent(q, false)
  assert.equal(routingDoubt('show pending orders', kw('show pending orders'), false), null)
  assert.equal(routingDoubt('status of ORD-1003', kw('status of ORD-1003'), true), null)
  assert.equal(routingDoubt('what can you tell me about Pacific?', kw('what can you tell me about Pacific?'), false), 'no keyword match')
  assert.notEqual(routingDoubt('and last month?', kw('and last month?'), true), null)
  assert.equal(routingDoubt('only pending orders', kw('only pending orders'), true), 'looks like a follow-up')
  assert.equal(routingDoubt('only pending orders', kw('only pending orders'), false), null)
  assert.equal(routingDoubt('what is our balance?', { tools: ['list_my_invoices'] }, false), 'ambiguous wording')
  assert.equal(routingDoubt('show bills and invoices', kw('show bills and invoices'), false), 'several lookups matched')
  assert.equal(routingDoubt('compare sales this quarter vs last quarter', kw('compare sales this quarter vs last quarter'), false), 'may need several lookups')
})
