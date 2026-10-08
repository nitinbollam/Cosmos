import { DEFAULT_GATEWAY_PATH } from '@pleros/web-gateway-client'
import { authFetch } from '@/lib/auth-session'

export type CelestialStreamDone = {
  conversationId: string
  links: Array<{ label: string; href: string }>
  toolsUsed: string[]
  provider: string
  model: string
}

type StreamHandlers = {
  onDelta: (text: string) => void
  onDone: (payload: CelestialStreamDone) => void
  onError: (message: string) => void
}

function parseSseBlock(block: string, handlers: StreamHandlers) {
  const lines = block.split('\n')
  let event = 'message'
  let data = ''
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  if (!data) return
  try {
    const payload = JSON.parse(data) as Record<string, unknown>
    if (event === 'delta' && typeof payload.text === 'string') handlers.onDelta(payload.text)
    if (event === 'done') handlers.onDone(payload as CelestialStreamDone)
    if (event === 'error' && typeof payload.message === 'string') handlers.onError(payload.message)
  } catch {
    handlers.onError('Invalid stream data from Celestial')
  }
}

async function consumeSseResponse(res: Response, handlers: StreamHandlers) {
  if (!res.body) throw new Error('Empty stream response')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      if (!part.trim()) continue
      parseSseBlock(part, handlers)
    }
  }

  if (buffer.trim()) {
    parseSseBlock(buffer, handlers)
  }
}

async function consumeJsonResponse(res: Response, handlers: StreamHandlers) {
  const json = (await res.json()) as CelestialStreamDone & { reply?: string }
  const reply = json.reply ?? ''
  if (reply) {
    const parts = reply.match(/\S+\s*|\s+/g) ?? [reply]
    for (const part of parts) {
      handlers.onDelta(part)
      await new Promise((r) => setTimeout(r, 12))
    }
  }
  handlers.onDone({
    conversationId: json.conversationId,
    links: json.links ?? [],
    toolsUsed: json.toolsUsed ?? [],
    provider: json.provider,
    model: json.model,
  })
}

async function postCelestial(gateway: string, path: string, body: unknown, signal?: AbortSignal) {
  // authFetch adds the token, refreshes once on 401 and ends the session if that fails.
  return authFetch(`${gateway}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Celestial-Stream': '1',
    },
    body: JSON.stringify(body),
    signal,
  })
}

export async function streamCelestialChat(
  baseUrl: string,
  loginPath: string,
  body: unknown,
  handlers: StreamHandlers,
  signal?: AbortSignal,
) {
  const gateway = baseUrl || DEFAULT_GATEWAY_PATH

  let res = await postCelestial(gateway, '/celestial/chat/stream', body, signal)
  if (res.status === 404) {
    res = await postCelestial(gateway, '/celestial/chat', body, signal)
  }

  // authFetch has already sent the user to sign in if the session could not be refreshed.
  if (res.status === 401) throw new Error('Session expired — please sign in again')

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const json = (await res.json()) as { message?: string }
      if (json.message) message = json.message
    } catch {
      // ignore
    }
    throw new Error(message)
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) {
    await consumeSseResponse(res, handlers)
    return
  }

  await consumeJsonResponse(res, handlers)
}
