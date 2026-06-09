import { auditLog } from '../audit-log'
import { getAuthProfile, isPortalBuyer, requirePortalCustomerId } from '../buyer-context'
import { assertFeature } from '../feature-flags'
import { ApiError, type SessionUser } from '../session'
import {
  appendMessage,
  getConversation,
  getOrCreateConversation,
  listConversations,
  touchConversation,
} from './conversations'
import { detectIntent, isPlainLanguagePreferred } from './intent'
import { completeChat, getCelestialModelInfo, streamChat, type ChatMessage } from './llm'
import { buildContextPrompt, buildSystemPrompt } from './prompts'
import { formatDocContext, retrievePlatformDocs } from './retrieval'
import { formatToolResultsForPrompt, runTools } from './tools'
import { buildDocFallbackReply, composeFromToolResults, toolResultHasData } from './compose'
import type { ToolResult } from './tools'
import type { CelestialToolName } from './intent'

function shouldUseDirectCompose(toolResults: ToolResult[]): boolean {
  return toolResults.some(toolResultHasData)
}

function buildContextBlock(
  message: string,
  toolResults: ToolResult[],
  docs: ReturnType<typeof retrievePlatformDocs>,
  page?: string,
): string {
  const parts: string[] = []

  if (toolResults.some(toolResultHasData)) {
    parts.push(`LIVE COSMOS DATA (use this in your answer):\n${composeFromToolResults(toolResults)}`)
  } else if (toolResults.length > 0) {
    parts.push(
      `LIVE COSMOS DATA (queries ran, no matching records):\n${formatToolResultsForPrompt(toolResults)}`,
    )
  }

  parts.push(`Platform documentation:\n${formatDocContext(docs)}`)
  if (page) parts.push(`Current UI page: ${page}`)

  return parts.join('\n\n')
}

function finalizeReply(
  message: string,
  reply: string,
  docs: ReturnType<typeof retrievePlatformDocs>,
  plainLanguage = true,
): string {
  const trimmed = reply.trim()
  if (trimmed) return trimmed
  return buildDocFallbackReply(message, docs, plainLanguage)
}

export type CelestialChatInput = {
  message: string
  conversationId?: string
  surface?: 'shop' | 'admin'
  context?: { page?: string; orderId?: string; quoteId?: string }
}

export type CelestialChatResult = {
  conversationId: string
  reply: string
  links: Array<{ label: string; href: string }>
  toolsUsed: string[]
  provider: string
  model: string
}

export { getCelestialModelInfo }

type PreparedChat = {
  conversationId: string
  message: string
  intentTools: string[]
  messages: ChatMessage[]
  links: Array<{ label: string; href: string }>
  toolsUsed: string[]
  docs: ReturnType<typeof retrievePlatformDocs>
  directReply: string | null
  plainLanguage: boolean
}

async function prepareChat(session: SessionUser, input: CelestialChatInput): Promise<PreparedChat> {
  await assertFeature(session.tenantId, 'celestial')

  const message = input.message.trim()
  if (!message) throw new ApiError(400, 'message required')

  const profile = await getAuthProfile(session)
  const isBuyer = isPortalBuyer(session.role)
  const customerId = isBuyer ? await requirePortalCustomerId(session) : null
  const surface = input.surface ?? (isBuyer ? 'shop' : 'admin')

  const conversation = await getOrCreateConversation(
    session.tenantId,
    session.userId,
    session.role,
    surface,
    input.conversationId,
  )

  const intent = detectIntent(message, isBuyer, {
    orderId: input.context?.orderId,
    quoteId: input.context?.quoteId,
  })

  const plainLanguage = isPlainLanguagePreferred(message)
  const docs = retrievePlatformDocs(message, 6, plainLanguage)
  const toolResults = await runTools(intent.tools, {
    session,
    customerId,
    customerName: profile.customerName,
    orderId: intent.orderId,
    quoteId: intent.quoteId,
    searchTerm: intent.searchTerm,
    orderStatus: intent.orderStatus,
  })

  const history: ChatMessage[] = conversation.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-10)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const contextBlock = buildContextBlock(message, toolResults, docs, input.context?.page)

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(session, profile.customerName, plainLanguage) },
    ...history,
    { role: 'system', content: buildContextPrompt(message, contextBlock, plainLanguage) },
    { role: 'user', content: message },
  ]

  const directReply = shouldUseDirectCompose(toolResults) ? composeFromToolResults(toolResults) : null

  return {
    conversationId: conversation.id,
    message,
    intentTools: intent.tools,
    messages,
    links: toolResults.flatMap((t) => t.links).slice(0, 8),
    toolsUsed: toolResults.map((t) => t.name),
    docs,
    directReply,
    plainLanguage,
  }
}

async function persistChatResult(
  session: SessionUser,
  prepared: PreparedChat,
  reply: string,
  provider: string,
  model: string,
) {
  await appendMessage(prepared.conversationId, 'user', prepared.message, { tools: prepared.intentTools })
  await appendMessage(prepared.conversationId, 'assistant', reply, {
    provider,
    model,
    toolsUsed: prepared.toolsUsed,
    links: prepared.links,
  })
  await touchConversation(prepared.conversationId)

  void auditLog(session.tenantId, {
    action: 'celestial.chat',
    entityType: 'CelestialConversation',
    entityId: prepared.conversationId,
    userId: session.userId,
    metadata: { provider, tools: prepared.toolsUsed },
  }).catch(() => undefined)
}

export async function chat(session: SessionUser, input: CelestialChatInput): Promise<CelestialChatResult> {
  const prepared = await prepareChat(session, input)
  if (prepared.directReply) {
    await persistChatResult(session, prepared, prepared.directReply, 'cosmos', 'structured')
    return {
      conversationId: prepared.conversationId,
      reply: prepared.directReply,
      links: prepared.links,
      toolsUsed: prepared.toolsUsed,
      provider: 'cosmos',
      model: 'structured',
    }
  }

  let reply: string
  let provider: string
  let model: string
  try {
    const llm = await completeChat(prepared.messages)
    reply = finalizeReply(prepared.message, llm.content, prepared.docs, prepared.plainLanguage)
    provider = llm.provider
    model = llm.model
  } catch {
    reply = buildDocFallbackReply(prepared.message, prepared.docs, prepared.plainLanguage)
    provider = 'cosmos'
    model = 'fallback'
  }

  await persistChatResult(session, prepared, reply, provider, model)

  return {
    conversationId: prepared.conversationId,
    reply,
    links: prepared.links,
    toolsUsed: prepared.toolsUsed,
    provider,
    model,
  }
}

export async function chatStream(session: SessionUser, input: CelestialChatInput): Promise<Response> {
  const prepared = await prepareChat(session, input)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const streamText = async (text: string, provider: string, model: string) => {
        const parts = text.match(/\S+\s*|\s+/g) ?? [text]
        for (const part of parts) {
          send('delta', { text: part })
          await new Promise((r) => setTimeout(r, 8))
        }
        await persistChatResult(session, prepared, text, provider, model)
        send('done', {
          conversationId: prepared.conversationId,
          links: prepared.links,
          toolsUsed: prepared.toolsUsed,
          provider,
          model,
        })
        controller.close()
      }

      try {
        if (prepared.directReply) {
          await streamText(prepared.directReply, 'cosmos', 'structured')
          return
        }

        try {
          const gen = streamChat(prepared.messages)
          let result = await gen.next()
          let fullContent = ''

          while (!result.done) {
            fullContent += result.value
            send('delta', { text: result.value })
            result = await gen.next()
          }

          const llm = result.value
          const streamed = fullContent.trim()
          if (!streamed) {
            await streamText(
              buildDocFallbackReply(prepared.message, prepared.docs, prepared.plainLanguage),
              'cosmos',
              'fallback',
            )
            return
          }

          const reply = finalizeReply(prepared.message, streamed, prepared.docs, prepared.plainLanguage)
          await persistChatResult(session, prepared, reply, llm.provider, llm.model)
          send('done', {
            conversationId: prepared.conversationId,
            links: prepared.links,
            toolsUsed: prepared.toolsUsed,
            provider: llm.provider,
            model: llm.model,
          })
          controller.close()
        } catch {
          await streamText(
            buildDocFallbackReply(prepared.message, prepared.docs, prepared.plainLanguage),
            'cosmos',
            'fallback',
          )
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Celestial stream failed'
        send('error', { message })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

type MessageMetadata = {
  provider?: string
  model?: string
  toolsUsed?: string[]
  links?: Array<{ label: string; href: string }>
}

function formatMessageMeta(metadata: MessageMetadata | null | undefined): string | undefined {
  if (!metadata?.provider) return undefined
  const tools = metadata.toolsUsed?.length ? ` · ${metadata.toolsUsed.join(', ')}` : ''
  return `${metadata.provider}/${metadata.model ?? 'unknown'}${tools}`
}

export async function listCelestialConversations(
  session: SessionUser,
  opts?: { surface?: 'shop' | 'admin'; limit?: number },
) {
  await assertFeature(session.tenantId, 'celestial')

  const rows = await listConversations(session.tenantId, session.userId, {
    limit: opts?.limit ?? 10,
    surface: opts?.surface,
  })

  return {
    items: rows.map((c) => ({
      id: c.id,
      surface: c.surface,
      title: c.title,
      updatedAt: c.updatedAt,
      preview: c.messages[0]?.content?.slice(0, 160) ?? '',
    })),
  }
}

export async function getCelestialConversation(session: SessionUser, conversationId: string) {
  await assertFeature(session.tenantId, 'celestial')

  const conversation = await getConversation(session.tenantId, session.userId, conversationId)

  return {
    id: conversation.id,
    surface: conversation.surface,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map((m) => {
      const metadata = (m.metadata ?? {}) as MessageMetadata
      return {
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        links: metadata.links,
        meta: formatMessageMeta(metadata),
        createdAt: m.createdAt,
      }
    }),
  }
}
