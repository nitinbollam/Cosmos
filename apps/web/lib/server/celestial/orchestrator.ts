import { auditLog } from '../audit-log'
import { getAuthProfile, isPortalBuyer, requirePortalCustomerId } from '../buyer-context'
import { assertFeature } from '../feature-flags'
import { ApiError, type SessionUser } from '../session'
import { appendMessage, getOrCreateConversation, touchConversation } from './conversations'
import { detectIntent } from './intent'
import { completeChat, getCelestialModelInfo, type ChatMessage } from './llm'
import { buildSystemPrompt } from './prompts'
import { formatDocContext, retrievePlatformDocs } from './retrieval'
import { formatToolResultsForPrompt, runTools } from './tools'

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

export async function chat(session: SessionUser, input: CelestialChatInput): Promise<CelestialChatResult> {
  await assertFeature(session.tenantId, 'celestial')

  const message = input.message.trim()
  if (!message) throw new ApiError(400, 'message required')

  const profile = await getAuthProfile(session)
  const isBuyer = isPortalBuyer(session.role)
  const customerId = isBuyer ? await requirePortalCustomerId(session) : profile.customerId
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

  const docs = retrievePlatformDocs(message)
  const toolResults = await runTools(intent.tools, {
    session,
    customerId,
    customerName: profile.customerName,
    orderId: intent.orderId,
    quoteId: intent.quoteId,
    searchTerm: intent.searchTerm,
  })

  const history: ChatMessage[] = conversation.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-8)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const dataContext = [
    `Platform documentation:\n${formatDocContext(docs)}`,
    `Live Cosmos data:\n${formatToolResultsForPrompt(toolResults)}`,
    input.context?.page ? `Current UI page: ${input.context.page}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(session, profile.customerName) },
    ...history,
    {
      role: 'user',
      content: `${message}\n\n---\n${dataContext}`,
    },
  ]

  const llm = await completeChat(messages)
  const links = toolResults.flatMap((t) => t.links).slice(0, 8)

  await appendMessage(conversation.id, 'user', message, { tools: intent.tools })
  await appendMessage(conversation.id, 'assistant', llm.content, {
    provider: llm.provider,
    model: llm.model,
    toolsUsed: toolResults.map((t) => t.name),
  })
  await touchConversation(conversation.id)

  void auditLog(session.tenantId, {
    action: 'celestial.chat',
    entityType: 'CelestialConversation',
    entityId: conversation.id,
    userId: session.userId,
    metadata: { provider: llm.provider, tools: toolResults.map((t) => t.name) },
  }).catch(() => undefined)

  return {
    conversationId: conversation.id,
    reply: llm.content,
    links,
    toolsUsed: toolResults.map((t) => t.name),
    provider: llm.provider,
    model: llm.model,
  }
}
