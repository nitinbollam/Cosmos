export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type LlmResponse = {
  content: string
  provider: string
  model: string
}

type Provider = 'openrouter' | 'groq' | 'gemini' | 'ollama' | 'mock'

function resolveProvider(): Provider {
  const explicit = process.env.CELESTIAL_PROVIDER?.trim().toLowerCase()
  if (
    explicit === 'openrouter' ||
    explicit === 'groq' ||
    explicit === 'gemini' ||
    explicit === 'ollama' ||
    explicit === 'mock'
  ) {
    return explicit
  }
  if (process.env.OPENROUTER_API_KEY?.trim()) return 'openrouter'
  if (process.env.GROQ_API_KEY?.trim()) return 'groq'
  if (process.env.GEMINI_API_KEY?.trim()) return 'gemini'
  if (process.env.CELESTIAL_OLLAMA_URL?.trim() || process.env.OLLAMA_HOST) return 'ollama'
  return 'mock'
}

function defaultModel(provider: Provider): string {
  if (process.env.CELESTIAL_MODEL?.trim()) return process.env.CELESTIAL_MODEL.trim()
  switch (provider) {
    case 'openrouter':
      return 'openrouter/auto'
    case 'groq':
      return 'llama-3.3-70b-versatile'
    case 'gemini':
      return 'gemini-2.0-flash'
    case 'ollama':
      return process.env.CELESTIAL_OLLAMA_MODEL?.trim() || 'llama3.2'
    default:
      return 'mock'
  }
}

export function getCelestialModelInfo() {
  const provider = resolveProvider()
  return {
    provider,
    model: defaultModel(provider),
    configured: provider !== 'mock',
    suggestions: [
      'OpenRouter: OPENROUTER_API_KEY + CELESTIAL_PROVIDER=openrouter + CELESTIAL_MODEL=openrouter/auto',
      'Groq (free): GROQ_API_KEY + CELESTIAL_PROVIDER=groq + CELESTIAL_MODEL=llama-3.3-70b-versatile',
      'Google Gemini (free tier): GEMINI_API_KEY + CELESTIAL_PROVIDER=gemini + CELESTIAL_MODEL=gemini-2.0-flash',
      'Ollama (local, free): ollama pull llama3.2 + CELESTIAL_PROVIDER=ollama',
    ],
  }
}

export async function completeChat(messages: ChatMessage[]): Promise<LlmResponse> {
  const provider = resolveProvider()
  const model = defaultModel(provider)

  switch (provider) {
    case 'openrouter':
      return callOpenAiCompatible(messages, {
        provider: 'openrouter',
        model,
        url:
          process.env.OPENROUTER_API_URL?.trim() || 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: process.env.OPENROUTER_API_KEY!,
        headers: {
          'HTTP-Referer': process.env.COSMOS_CLIENT_ORIGIN?.trim() || 'http://localhost:4000',
          'X-Title': 'Cosmos Celestial',
        },
      })
    case 'groq':
      return callOpenAiCompatible(messages, {
        provider: 'groq',
        model,
        url: 'https://api.groq.com/openai/v1/chat/completions',
        apiKey: process.env.GROQ_API_KEY!,
      })
    case 'gemini':
      return callGemini(messages, model)
    case 'ollama':
      return callOllama(messages, model)
    default:
      return mockComplete(messages, model)
  }
}

async function callOpenAiCompatible(
  messages: ChatMessage[],
  cfg: { provider: string; model: string; url: string; apiKey: string; headers?: Record<string, string> },
): Promise<LlmResponse> {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      ...cfg.headers,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.3,
      max_tokens: 800,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${cfg.provider} error (${res.status}): ${text.slice(0, 300)}`)
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = json.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error(`${cfg.provider} returned empty response`)
  return { content, provider: cfg.provider, model: cfg.model }
}

async function callGemini(messages: ChatMessage[], model: string): Promise<LlmResponse> {
  const key = process.env.GEMINI_API_KEY!.trim()
  const system = messages.find((m) => m.role === 'system')?.content ?? ''
  const convo = messages.filter((m) => m.role !== 'system')
  const contents = convo.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`gemini error (${res.status}): ${text.slice(0, 300)}`)
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const content = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  if (!content) throw new Error('gemini returned empty response')
  return { content, provider: 'gemini', model }
}

async function callOllama(messages: ChatMessage[], model: string): Promise<LlmResponse> {
  const base = (process.env.CELESTIAL_OLLAMA_URL ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '')
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0.3 } }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`ollama error (${res.status}): ${text.slice(0, 300)}`)
  }
  const json = (await res.json()) as { message?: { content?: string } }
  const content = json.message?.content?.trim()
  if (!content) throw new Error('ollama returned empty response')
  return { content, provider: 'ollama', model }
}

function mockComplete(messages: ChatMessage[], model: string): LlmResponse {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const toolBlock = messages.find((m) => m.content.includes('Tool:'))?.content ?? ''
  const lines: string[] = []

  if (toolBlock.includes('get_my_orders') || toolBlock.includes('get_order_detail')) {
    lines.push('Here is what I found about your orders:')
    const match = toolBlock.match(/"status":\s*"([A-Z_]+)"/g)
    if (match?.length) {
      lines.push(...match.slice(0, 5).map((m) => `- Status ${m.split('"')[3]}`))
    }
    lines.push('Open **Orders** in the portal for full tracking and shipment details.')
  } else if (toolBlock.includes('list_my_invoices')) {
    lines.push('I pulled your recent invoices from Cosmos.')
    lines.push('Check **Invoices** for PDFs, balances, and payment history.')
  } else if (toolBlock.includes('search_catalog')) {
    lines.push('I searched the catalog for matching in-stock SKUs.')
    lines.push('Visit **Catalog** to add items to your cart.')
  } else if (toolBlock.includes('list_my_quotes')) {
    lines.push('Here are your open quotes in Cosmos.')
    lines.push('Open **Quotes** to accept, counter-offer, or convert to an order.')
  } else if (toolBlock.includes('global_search') || toolBlock.includes('list_low_stock')) {
    lines.push('I ran an admin search across Cosmos records.')
    lines.push('Use the linked admin pages for full detail.')
  } else {
    lines.push(`I'm Celestial, your Cosmos assistant.`)
    lines.push(`You asked: "${lastUser.slice(0, 120)}"`)
    lines.push(
      'Configure OPENROUTER_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, or Ollama for richer AI answers. I can still help with orders, invoices, catalog, and quotes using live data.',
    )
  }

  return {
    content: lines.join('\n\n'),
    provider: 'mock',
    model,
  }
}
