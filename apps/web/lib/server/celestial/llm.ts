/**
 * Celestial model routing: Groq primary, then one hosted fallback chosen by CELESTIAL_FALLBACK —
 * OpenRouter (default) or Ollama Cloud (OLLAMA_API_KEY). Local Ollama is not part of the chain.
 *
 * - Cloud routing needs CELESTIAL_EXTERNAL_ROUTING_APPROVED=true. API keys alone never enable it.
 * - Sending ERP evidence or conversation history to a provider additionally needs
 *   CELESTIAL_EXTERNAL_DATA_APPROVED=true (enforced by the orchestrator, see shouldShareErpData).
 * - Failover is bounded to the configured steps, happens only before any text has streamed, and
 *   never re-runs ERP reads (those finish before the model is called).
 * - Provider errors are reduced to a fixed category plus allowlisted metadata; response bodies,
 *   which can echo the prompt, are never logged or surfaced.
 * Without approval or keys Celestial runs in offline mock mode.
 */

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type LlmResponse = {
  content: string
  provider: string
  model: string
}

type Env = Record<string, string | undefined>
type FetchFn = typeof fetch

export type LlmOptions = { env?: Env; fetch?: FetchFn; now?: () => number }

export const DEFAULT_PRIMARY_MODEL = 'openai/gpt-oss-120b'
export const DEFAULT_FALLBACK_MODEL = 'xingchen-agi/xing4.0-29b-a4b:free'
export const DEFAULT_OLLAMA_FALLBACK_MODEL = 'gpt-oss:120b'
const DEFAULT_PRIMARY_TIMEOUT_MS = 8_000
const DEFAULT_FALLBACK_TIMEOUT_MS = 25_000
const DEFAULT_COOLDOWN_MS = 60_000
/** Cap on a whole streamed answer once it has started. */
const STREAM_TOTAL_TIMEOUT_MS = 90_000

export type RouteStep = {
  provider: 'groq' | 'openrouter' | 'ollama'
  model: string
  url: string
  apiKey: string
  timeoutMs: number
  headers?: Record<string, string>
  /** Extra request-body fields (OpenRouter provider routing / privacy preferences). */
  extraBody?: Record<string, unknown>
}

export type ProviderErrorCategory = 'timeout' | 'rate_limited' | 'auth' | 'bad_request' | 'upstream' | 'empty' | 'network'

export class CelestialProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly category: ProviderErrorCategory,
    readonly meta: { status?: number; requestId?: string; retryAfterMs?: number; upstream?: string } = {},
  ) {
    super(`${provider} ${category}${meta.status ? ` (HTTP ${meta.status})` : ''}`)
    this.name = 'CelestialProviderError'
  }
}

/** Thrown when a provider fails after text has already been streamed; carries what was sent. */
export class CelestialStreamInterrupted extends Error {
  constructor(
    readonly partial: string,
    readonly cause: CelestialProviderError,
  ) {
    super(`stream interrupted: ${cause.message}`)
    this.name = 'CelestialStreamInterrupted'
  }
}

function flag(env: Env, name: string, fallback = false): boolean {
  const v = env[name]?.trim().toLowerCase()
  if (!v) return fallback
  return v === 'true' || v === '1' || v === 'yes'
}

function intEnv(env: Env, name: string, fallback: number): number {
  const n = Number(env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function isExternalRoutingApproved(env: Env = process.env): boolean {
  return flag(env, 'CELESTIAL_EXTERNAL_ROUTING_APPROVED')
}

export function isExternalDataApproved(env: Env = process.env): boolean {
  return flag(env, 'CELESTIAL_EXTERNAL_DATA_APPROVED')
}

/** The ordered provider chain, plus why it is empty when it is. */
export function resolveRoute(env: Env = process.env): { steps: RouteStep[]; blockedReason?: string } {
  if (!isExternalRoutingApproved(env)) {
    return { steps: [], blockedReason: 'external routing not approved (CELESTIAL_EXTERNAL_ROUTING_APPROVED)' }
  }
  const steps: RouteStep[] = []

  const groqKey = env.GROQ_API_KEY?.trim()
  if (groqKey) {
    steps.push({
      provider: 'groq',
      model: env.CELESTIAL_PRIMARY_MODEL?.trim() || DEFAULT_PRIMARY_MODEL,
      url: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: groqKey,
      timeoutMs: intEnv(env, 'CELESTIAL_PRIMARY_TIMEOUT_MS', DEFAULT_PRIMARY_TIMEOUT_MS),
    })
  }

  const fallback = fallbackKind(env)
  const fallbackTimeoutMs = intEnv(env, 'CELESTIAL_FALLBACK_TIMEOUT_MS', DEFAULT_FALLBACK_TIMEOUT_MS)

  const ollamaKey = env.OLLAMA_API_KEY?.trim()
  if (fallback === 'ollama' && ollamaKey) {
    steps.push({
      provider: 'ollama',
      model: env.CELESTIAL_FALLBACK_MODEL?.trim() || DEFAULT_OLLAMA_FALLBACK_MODEL,
      url: env.OLLAMA_API_URL?.trim() || 'https://ollama.com/v1/chat/completions',
      apiKey: ollamaKey,
      timeoutMs: fallbackTimeoutMs,
    })
  }

  const orKey = env.OPENROUTER_API_KEY?.trim()
  const fallbackModel = env.CELESTIAL_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL
  const freeOnly = flag(env, 'CELESTIAL_FALLBACK_FREE_ONLY', true)
  if (fallback === 'openrouter' && orKey && (!freeOnly || fallbackModel.endsWith(':free'))) {
    const only = (env.CELESTIAL_OPENROUTER_PROVIDERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    steps.push({
      provider: 'openrouter',
      model: fallbackModel,
      url: env.OPENROUTER_API_URL?.trim() || 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: orKey,
      timeoutMs: fallbackTimeoutMs,
      headers: {
        'HTTP-Referer': env.PLEROS_CLIENT_ORIGIN?.trim() || 'http://localhost:4000',
        'X-Title': 'Pleros Celestial',
      },
      extraBody: {
        provider: {
          data_collection: 'deny',
          zdr: true,
          allow_fallbacks: false,
          ...(only.length > 0 ? { only } : {}),
        },
      },
    })
  }

  return steps.length > 0
    ? { steps }
    : { steps, blockedReason: 'no GROQ_API_KEY or fallback key (OPENROUTER_API_KEY / OLLAMA_API_KEY) configured' }
}

/** Which hosted fallback follows Groq: CELESTIAL_FALLBACK=openrouter (default) | ollama | none. */
function fallbackKind(env: Env): 'openrouter' | 'ollama' | 'none' {
  const v = env.CELESTIAL_FALLBACK?.trim().toLowerCase()
  return v === 'ollama' || v === 'none' ? v : 'openrouter'
}

/** Whether ERP evidence and history may go into the model prompt for this deployment. */
export function shouldShareErpData(env: Env = process.env): boolean {
  // Mock/offline mode keeps everything in-process, so there is nothing to withhold.
  if (resolveRoute(env).steps.length === 0) return true
  return isExternalDataApproved(env)
}

export function getCelestialModelInfo(env: Env = process.env) {
  const { steps, blockedReason } = resolveRoute(env)
  const primary = steps[0]
  return {
    provider: primary?.provider ?? 'mock',
    model: primary?.model ?? 'mock',
    configured: steps.length > 0,
    route: steps.map((s) => ({ provider: s.provider, model: s.model, timeoutMs: s.timeoutMs })),
    externalDataApproved: isExternalDataApproved(env),
    ...(blockedReason ? { blockedReason } : {}),
    suggestions: [
      'Set CELESTIAL_EXTERNAL_ROUTING_APPROVED=true to allow cloud model calls at all',
      `Primary: GROQ_API_KEY (+ optional CELESTIAL_PRIMARY_MODEL, default ${DEFAULT_PRIMARY_MODEL})`,
      `Fallback (CELESTIAL_FALLBACK=openrouter): OPENROUTER_API_KEY (+ optional CELESTIAL_FALLBACK_MODEL, default ${DEFAULT_FALLBACK_MODEL})`,
      `Fallback (CELESTIAL_FALLBACK=ollama): OLLAMA_API_KEY for Ollama Cloud (+ optional CELESTIAL_FALLBACK_MODEL, default ${DEFAULT_OLLAMA_FALLBACK_MODEL})`,
      'Set CELESTIAL_EXTERNAL_DATA_APPROVED=true only once sending ERP data to these providers is approved',
    ],
  }
}

// ── Rate-limit cooldowns ─────────────────────────────────────────────────────

const cooldownUntil = new Map<string, number>()

export function resetProviderCooldowns(): void {
  cooldownUntil.clear()
}

/**
 * Milliseconds to wait from rate-limit headers. Handles `retry-after` (seconds or HTTP date) and
 * `x-ratelimit-reset` (epoch seconds or milliseconds, as OpenRouter sends). Undefined when absent.
 */
export function parseRetryAfterMs(headers: Headers, now: number): number | undefined {
  const retryAfter = headers.get('retry-after')?.trim()
  if (retryAfter) {
    const secs = Number(retryAfter)
    if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000)
    const date = Date.parse(retryAfter)
    if (!Number.isNaN(date)) return Math.max(0, date - now)
  }
  const reset = headers.get('x-ratelimit-reset')?.trim()
  if (reset && /^\d+(\.\d+)?$/.test(reset)) {
    const n = Number(reset)
    const epochMs = n > 1e12 ? n : n * 1000
    if (epochMs > now) return epochMs - now
  }
  return undefined
}

function categoryForStatus(status: number): ProviderErrorCategory {
  if (status === 429) return 'rate_limited'
  if (status === 401 || status === 403) return 'auth'
  if (status === 400 || status === 404 || status === 413 || status === 422) return 'bad_request'
  return 'upstream'
}

/** Only these response headers are kept for diagnostics. */
function requestIdOf(headers: Headers): string | undefined {
  return headers.get('x-request-id') ?? headers.get('x-groq-id') ?? headers.get('cf-ray') ?? undefined
}

/** Upstream provider name from an OpenRouter error body, without keeping the rest of the body. */
async function upstreamOf(res: Response): Promise<string | undefined> {
  try {
    const json = (await res.json()) as { error?: { metadata?: { provider_name?: unknown } } }
    const name = json?.error?.metadata?.provider_name
    return typeof name === 'string' ? name.slice(0, 60) : undefined
  } catch {
    // Non-JSON or empty body: the HTTP status alone classifies it.
    return undefined
  }
}

function logProviderError(err: CelestialProviderError): void {
  const m = err.meta
  console.warn(
    `[celestial] provider=${err.provider} category=${err.category}` +
      (m.status ? ` status=${m.status}` : '') +
      (m.requestId ? ` request_id=${m.requestId}` : '') +
      (m.upstream ? ` upstream=${m.upstream}` : '') +
      (m.retryAfterMs != null ? ` cooldown_ms=${m.retryAfterMs}` : ''),
  )
}

async function openRequest(step: RouteStep, messages: ChatMessage[], stream: boolean, f: FetchFn, signal: AbortSignal, now: number) {
  let res: Response
  try {
    res = await f(step.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${step.apiKey}`,
        'Content-Type': 'application/json',
        ...(stream ? { Accept: 'text/event-stream' } : {}),
        ...step.headers,
      },
      body: JSON.stringify({
        model: step.model,
        messages,
        temperature: 0.3,
        max_tokens: 800,
        ...(stream ? { stream: true } : {}),
        ...step.extraBody,
      }),
      signal,
    })
  } catch {
    throw new CelestialProviderError(step.provider, signal.aborted ? 'timeout' : 'network')
  }
  if (!res.ok) {
    const category = categoryForStatus(res.status)
    throw new CelestialProviderError(step.provider, category, {
      status: res.status,
      requestId: requestIdOf(res.headers),
      upstream: await upstreamOf(res),
      ...(category === 'rate_limited' ? { retryAfterMs: parseRetryAfterMs(res.headers, now) ?? DEFAULT_COOLDOWN_MS } : {}),
    })
  }
  return res
}

function noteFailure(err: CelestialProviderError, now: number): void {
  logProviderError(err)
  if (err.category === 'rate_limited') cooldownUntil.set(err.provider, now + (err.meta.retryAfterMs ?? DEFAULT_COOLDOWN_MS))
}

function availableSteps(steps: RouteStep[], now: number): RouteStep[] {
  return steps.filter((s) => (cooldownUntil.get(s.provider) ?? 0) <= now)
}

function toProviderError(e: unknown, provider: string): CelestialProviderError {
  return e instanceof CelestialProviderError ? e : new CelestialProviderError(provider, 'network')
}

export async function completeChat(messages: ChatMessage[], opts: LlmOptions = {}): Promise<LlmResponse> {
  const env = opts.env ?? process.env
  const f = opts.fetch ?? fetch
  const now = opts.now ?? Date.now
  const { steps } = resolveRoute(env)
  if (steps.length === 0) return mockComplete(messages)

  let last: CelestialProviderError | undefined
  for (const step of availableSteps(steps, now())) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), step.timeoutMs)
    try {
      const res = await openRequest(step, messages, false, f, controller.signal, now())
      let json: { choices?: Array<{ message?: { content?: string } }> }
      try {
        json = (await res.json()) as typeof json
      } catch {
        throw new CelestialProviderError(step.provider, controller.signal.aborted ? 'timeout' : 'upstream', { status: res.status })
      }
      const content = json.choices?.[0]?.message?.content?.trim()
      if (!content) throw new CelestialProviderError(step.provider, 'empty', { requestId: requestIdOf(res.headers) })
      return { content, provider: step.provider, model: step.model }
    } catch (e) {
      last = toProviderError(e, step.provider)
      noteFailure(last, now())
    } finally {
      clearTimeout(timer)
    }
  }
  throw last ?? new CelestialProviderError(steps[0].provider, 'rate_limited', { retryAfterMs: DEFAULT_COOLDOWN_MS })
}

export async function* streamChat(messages: ChatMessage[], opts: LlmOptions = {}): AsyncGenerator<string, LlmResponse> {
  const env = opts.env ?? process.env
  const f = opts.fetch ?? fetch
  const now = opts.now ?? Date.now
  const { steps } = resolveRoute(env)
  if (steps.length === 0) {
    const mock = mockComplete(messages)
    return yield* simulateStream(mock.content, mock)
  }

  let last: CelestialProviderError | undefined
  for (const step of availableSteps(steps, now())) {
    const controller = new AbortController()
    // Until the first token the step's own timeout applies; after that, only the overall cap.
    let timer = setTimeout(() => controller.abort(), step.timeoutMs)
    let content = ''
    try {
      const res = await openRequest(step, messages, true, f, controller.signal, now())
      if (!res.body) throw new CelestialProviderError(step.provider, 'empty', { status: res.status })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        let chunk: Awaited<ReturnType<typeof reader.read>>
        try {
          chunk = await reader.read()
        } catch {
          throw new CelestialProviderError(step.provider, controller.signal.aborted ? 'timeout' : 'network')
        }
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const delta = parseSseDelta(line)
          if (!delta) continue
          if (!content) {
            clearTimeout(timer)
            timer = setTimeout(() => controller.abort(), STREAM_TOTAL_TIMEOUT_MS)
          }
          content += delta
          yield delta
        }
      }
      if (!content.trim()) throw new CelestialProviderError(step.provider, 'empty', { requestId: requestIdOf(res.headers) })
      return { content: content.trim(), provider: step.provider, model: step.model }
    } catch (e) {
      last = toProviderError(e, step.provider)
      noteFailure(last, now())
      // Text already reached the user: switching providers now would splice two different answers.
      if (content) throw new CelestialStreamInterrupted(content, last)
    } finally {
      clearTimeout(timer)
    }
  }
  throw last ?? new CelestialProviderError(steps[0].provider, 'rate_limited', { retryAfterMs: DEFAULT_COOLDOWN_MS })
}

function parseSseDelta(line: string): string | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return undefined
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === '[DONE]') return undefined
  try {
    const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
    return json.choices?.[0]?.delta?.content || undefined
  } catch {
    // Keep-alive comments and partial frames are not deltas.
    return undefined
  }
}

async function* simulateStream(content: string, result: LlmResponse): AsyncGenerator<string, LlmResponse> {
  const parts = content.match(/\S+\s*|\s+/g) ?? [content]
  for (const part of parts) {
    yield part
    await new Promise((r) => setTimeout(r, 16))
  }
  return result
}

function mockComplete(messages: ChatMessage[]): LlmResponse {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const lines = [
    `I'm Celestial, your Pleros assistant.`,
    `You asked: "${lastUser.slice(0, 120)}"`,
    'No cloud model is enabled, so I can only answer from live Pleros records and the built-in guides. Try asking about orders, stock, purchase orders, vendor bills or quotes.',
  ]
  return { content: lines.join('\n\n'), provider: 'mock', model: 'mock' }
}
