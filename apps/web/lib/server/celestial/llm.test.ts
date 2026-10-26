import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CelestialProviderError,
  CelestialStreamInterrupted,
  completeChat,
  parseRetryAfterMs,
  resetProviderCooldowns,
  resolveRoute,
  shouldShareErpData,
  streamChat,
} from './llm'

const APPROVED = {
  CELESTIAL_EXTERNAL_ROUTING_APPROVED: 'true',
  GROQ_API_KEY: 'test-groq',
  OLLAMA_API_KEY: 'test-ollama',
}
const MSGS = [{ role: 'user' as const, content: 'hi' }]

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function sse(chunks: string[], failAfter = false): Response {
  const enc = new TextEncoder()
  let i = 0
  // Pull-based so an error arrives only after the earlier chunks have been read.
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n\n`))
      } else if (failAfter) {
        c.error(new Error('socket closed'))
      } else {
        c.close()
      }
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** Fake fetch that answers per provider host and records every call. */
type Handler = () => Response | Promise<Response>
function fakeFetch(handlers: { groq?: Handler; ollama?: Handler }) {
  const calls: Array<{ provider: string; body: Record<string, unknown> }> = []
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const provider = u.includes('groq') ? 'groq' : u.includes('ollama.com') ? 'ollama' : 'unknown'
    calls.push({ provider, body: JSON.parse(String(init?.body)) })
    const h = handlers[provider as 'groq' | 'ollama']
    if (!h) throw new Error('unexpected call')
    return h()
  }) as typeof fetch
  return { f, calls }
}

test('keys alone do not enable cloud routing', () => {
  const r = resolveRoute({ GROQ_API_KEY: 'k', OLLAMA_API_KEY: 'k' })
  assert.equal(r.steps.length, 0)
  assert.match(r.blockedReason ?? '', /not approved/)
})

test('route is Groq primary then Ollama Cloud fallback; OpenRouter, Gemini and local Ollama are ignored', () => {
  const r = resolveRoute({
    ...APPROVED,
    OPENROUTER_API_KEY: 'or',
    GEMINI_API_KEY: 'g',
    CELESTIAL_OLLAMA_URL: 'http://127.0.0.1:11434',
  })
  assert.deepEqual(r.steps.map((s) => [s.provider, s.model, s.url, s.timeoutMs]), [
    ['groq', 'openai/gpt-oss-120b', 'https://api.groq.com/openai/v1/chat/completions', 8000],
    ['ollama', 'gpt-oss:120b', 'https://ollama.com/v1/chat/completions', 25000],
  ])
})

test('the fallback needs OLLAMA_API_KEY and can be turned off', () => {
  const { OLLAMA_API_KEY: _omit, ...noOllama } = APPROVED
  assert.deepEqual(resolveRoute(noOllama).steps.map((s) => s.provider), ['groq'])
  assert.deepEqual(resolveRoute({ ...APPROVED, CELESTIAL_FALLBACK: 'none' }).steps.map((s) => s.provider), ['groq'])
})

test('ERP data is shared only with explicit data approval', () => {
  assert.equal(shouldShareErpData({}), true) // offline mock: nothing leaves the process
  assert.equal(shouldShareErpData(APPROVED), false)
  assert.equal(shouldShareErpData({ ...APPROVED, CELESTIAL_EXTERNAL_DATA_APPROVED: 'true' }), true)
})

test('completeChat uses Groq when it answers', async () => {
  resetProviderCooldowns()
  const { f, calls } = fakeFetch({ groq: () => json({ choices: [{ message: { content: 'hello' } }] }) })
  const r = await completeChat(MSGS, { env: APPROVED, fetch: f })
  assert.deepEqual([r.provider, r.content], ['groq', 'hello'])
  assert.equal(calls.length, 1)
})

test('completeChat fails over to Ollama on 429 and cools Groq down', async () => {
  resetProviderCooldowns()
  let t = 1_000_000
  const { f, calls } = fakeFetch({
    groq: () => json({ error: { message: 'secret prompt echo' } }, 429, { 'retry-after': '30' }),
    ollama: () => json({ choices: [{ message: { content: 'from fallback' } }] }),
  })
  const r1 = await completeChat(MSGS, { env: APPROVED, fetch: f, now: () => t })
  assert.equal(r1.provider, 'ollama')
  t += 10_000
  await completeChat(MSGS, { env: APPROVED, fetch: f, now: () => t })
  assert.deepEqual(calls.map((c) => c.provider), ['groq', 'ollama', 'ollama'])
  t += 25_000
  await completeChat(MSGS, { env: APPROVED, fetch: f, now: () => t }).catch(() => undefined)
  assert.equal(calls[3].provider, 'groq', 'cooldown expired')
})

test('provider errors are categorised without the response body', async () => {
  resetProviderCooldowns()
  const { f } = fakeFetch({
    groq: () => json({ error: { message: 'secret prompt echo' } }, 401),
    ollama: () => new Response('<html>bad gateway</html>', { status: 502 }),
  })
  await assert.rejects(completeChat(MSGS, { env: APPROVED, fetch: f }), (e: unknown) => {
    assert.ok(e instanceof CelestialProviderError)
    assert.equal(e.provider, 'ollama')
    assert.equal(e.category, 'upstream')
    assert.doesNotMatch(e.message, /secret|html/)
    return true
  })
})

test('a slow primary times out and the fallback answers', async () => {
  resetProviderCooldowns()
  const { f } = fakeFetch({
    groq: () => new Promise<Response>(() => undefined),
    ollama: () => json({ choices: [{ message: { content: 'ok' } }] }),
  })
  // A hanging fetch never sees the abort signal in this fake, so race it with a short timeout via env.
  const slowAware = (async (url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      void f(url, init).then(resolve, reject)
    })) as typeof fetch
  const r = await completeChat(MSGS, { env: { ...APPROVED, CELESTIAL_PRIMARY_TIMEOUT_MS: '20' }, fetch: slowAware })
  assert.equal(r.provider, 'ollama')
})

test('streamChat falls back only before any text was sent', async () => {
  resetProviderCooldowns()
  const { f } = fakeFetch({
    groq: () => json({}, 503),
    ollama: () => sse(['Hel', 'lo']),
  })
  const gen = streamChat(MSGS, { env: APPROVED, fetch: f })
  let text = ''
  let r = await gen.next()
  while (!r.done) {
    text += r.value
    r = await gen.next()
  }
  assert.equal(text, 'Hello')
  assert.equal(r.value.provider, 'ollama')
})

test('streamChat does not splice a second provider after partial output', async () => {
  resetProviderCooldowns()
  const { f, calls } = fakeFetch({
    groq: () => sse(['Partial '], true),
    ollama: () => sse(['other answer']),
  })
  const gen = streamChat(MSGS, { env: APPROVED, fetch: f })
  let text = ''
  await assert.rejects(
    (async () => {
      let r = await gen.next()
      while (!r.done) {
        text += r.value
        r = await gen.next()
      }
    })(),
    (e: unknown) => e instanceof CelestialStreamInterrupted && e.partial === 'Partial ',
  )
  assert.equal(text, 'Partial ')
  assert.deepEqual(calls.map((c) => c.provider), ['groq'])
})

test('parseRetryAfterMs reads seconds, HTTP dates and epoch reset headers', () => {
  const now = Date.parse('2026-10-19T12:00:00Z')
  assert.equal(parseRetryAfterMs(new Headers({ 'retry-after': '12' }), now), 12_000)
  assert.equal(parseRetryAfterMs(new Headers({ 'retry-after': 'Mon, 19 Oct 2026 12:00:30 GMT' }), now), 30_000)
  assert.equal(parseRetryAfterMs(new Headers({ 'x-ratelimit-reset': String(now + 5_000) }), now), 5_000)
  assert.equal(parseRetryAfterMs(new Headers({ 'x-ratelimit-reset': String(now / 1000 + 7) }), now), 7_000)
  assert.equal(parseRetryAfterMs(new Headers({ 'x-ratelimit-limit': '20' }), now), undefined)
})


test('Ollama Cloud is still an external provider for the data-approval gate', () => {
  assert.equal(shouldShareErpData({ ...APPROVED, GROQ_API_KEY: '' }), false)
})

test('requests carry only the OpenAI-compatible fields', async () => {
  resetProviderCooldowns()
  const { f, calls } = fakeFetch({
    groq: () => json({}, 503),
    ollama: () => json({ choices: [{ message: { content: 'from ollama' } }] }),
  })
  const r = await completeChat(MSGS, { env: APPROVED, fetch: f })
  assert.deepEqual([r.provider, r.model, r.content], ['ollama', 'gpt-oss:120b', 'from ollama'])
  assert.deepEqual(Object.keys(calls[1].body).sort(), ['max_tokens', 'messages', 'model', 'temperature'])
})
