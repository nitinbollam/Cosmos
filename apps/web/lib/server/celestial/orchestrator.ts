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
import { detectIntent, isHowToQuestion, isPlainLanguagePreferred, type DetectedIntent } from './intent'
import {
  clarifyReply,
  describeLookup,
  planQuestion,
  routingDoubt,
  unsupportedReply,
  type Plan,
  type PlannerTurn,
} from './planner'
import {
  buildResultSets,
  intentForFollowUp,
  liveResultSets,
  resolveFollowUp,
  loadParams,
  storeParams,
  type ResultSet,
} from './result-sets'
import {
  CelestialStreamInterrupted,
  completeChat,
  getCelestialModelInfo,
  shouldShareErpData,
  streamChat,
  type ChatMessage,
} from './llm'
import { buildContextPrompt, buildSystemPrompt } from './prompts'
import { formatDocContext, retrievePlatformDocs } from './retrieval'
import { formatToolResultsForPrompt, runTools } from './tools'
import { buildDocFallbackReply, composeFromToolResults, toolResultHasData } from './compose'
import { smallTalkReply } from './smalltalk'
import { acceptSummary, buildSummaryMessages, shouldSummarize, summaryTimeoutMs, withDeadline } from './record-summary'
import type { ToolResult } from './tools'
import type { CelestialToolName } from './intent'

import { swallowed } from '../fire-and-forget'
function shouldUseDirectCompose(toolResults: ToolResult[]): boolean {
  return toolResults.some(toolResultHasData)
}

function buildContextBlock(
  message: string,
  toolResults: ToolResult[],
  docs: ReturnType<typeof retrievePlatformDocs>,
  page?: string,
  shareErpData = true,
): string {
  const parts: string[] = []

  if (!shareErpData) {
    // Sending ERP records to the configured cloud provider is not approved.
  } else if (toolResults.some(toolResultHasData)) {
    parts.push(`LIVE PLEROS DATA (use this in your answer):\n${composeFromToolResults(toolResults)}`)
  } else if (toolResults.length > 0) {
    parts.push(
      `LIVE PLEROS DATA (queries ran, no matching records):\n${formatToolResultsForPrompt(toolResults)}`,
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
  /** Add an AI-written summary above the server-built records answer. */
  summarize: boolean
  plainLanguage: boolean
  resultSets: ResultSet[]
  /** Lookups run for this answer (settings only), so the router can read follow-ups in context. */
  lookups: Array<{ tool: string; params: ReturnType<typeof storeParams> }>
  routedBy: 'keywords' | 'ai' | 'follow-up'
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

  // A follow-up ("open the second order", "show more") selects from a recent list answer in this
  // conversation; the selected record is still re-read through the permission-checked tools.
  const scope = { tenantId: session.tenantId, userId: session.userId, role: session.role }
  const recentSets = liveResultSets(
    conversation.messages
      .filter((m) => m.role === 'assistant')
      .reverse()
      .map((m) => m.metadata),
    scope,
  )
  const followUp = resolveFollowUp(message, recentSets)
  const followUpIntent = followUp ? intentForFollowUp(followUp) : undefined
  const clarification = followUpIntent && 'clarify' in followUpIntent ? followUpIntent.clarify : null
  const smallTalk = followUpIntent ? null : smallTalkReply(message, session)
  const keywordIntent: DetectedIntent =
    followUpIntent && !('clarify' in followUpIntent)
      ? followUpIntent
      : clarification || smallTalk
        ? { tools: [] }
        : detectIntent(message, isBuyer, {
            orderId: input.context?.orderId,
            quoteId: input.context?.quoteId,
          })

  // Keyword rules answer first. When they are unsure (no match, several matches, a follow-up that
  // refines the last question, ambiguous wording), the AI router decides instead; it sees only the
  // question, the lookups this employee may run and earlier lookup settings — never records.
  const earlier = earlierTurns(conversation.messages)
  const canPlan =
    !isBuyer && !followUpIntent && !clarification && !smallTalk && !isHowToQuestion(message) && getCelestialModelInfo().configured
  let calls: DetectedIntent[] = keywordIntent.tools.length > 0 ? [keywordIntent] : []
  let routedBy: PreparedChat['routedBy'] = followUpIntent ? 'follow-up' : 'keywords'
  let unsupported: string | null = null
  let askBack: string | null = null
  let planned = false

  const applyPlan = (plan: Plan | null): boolean => {
    planned = true
    if (!plan) return false
    routedBy = 'ai'
    calls = plan.type === 'tools' ? plan.calls : []
    if (plan.type === 'clarify') askBack = clarifyReply(plan)
    if (plan.type === 'unsupported') unsupported = unsupportedReply(message, session)
    return true
  }

  if (canPlan && routingDoubt(message, keywordIntent, earlier.length > 0)) {
    const plan = await planQuestion(message, session, {}, earlier)
    // A follow-up that points back ("when is it due?", "only the unpaid ones") and that the router
    // couldn't place reuses the previous lookup; the answer then carries the detail asked for.
    const previous = lastLookups(conversation.messages)
    const lower = message.toLowerCase()
    // With no keyword match any back-reference counts; when a keyword did match, only a pronoun
    // ("when is it due?") clearly points at the previous answer rather than a new lookup.
    const pointsBack = previous.length > 0 && (keywordIntent.tools.length === 0 ? POINTS_BACK : PRONOUN).test(lower)
    if (plan?.type !== 'tools' && pointsBack) {
      planned = true
      routedBy = 'ai'
      calls = previous.map((c) => (OUTSTANDING_WORDS.test(lower) ? { ...c, outstanding: true } : c))
    } else {
      applyPlan(plan)
    }
  }

  const runCall = (call: DetectedIntent) => {
    const { tools: names, ...callParams } = call
    return runTools(names, { ...callParams, session, customerId, customerName: profile.customerName })
  }
  let perCall = await Promise.all(calls.map(runCall))

  // AI check after the fact: a name search that found nothing may mean the words were misread
  // (e.g. "least" taken as a product name). Ask the router once and rerun if it routes differently.
  if (canPlan && !planned && searchFoundNothing(calls, perCall.flat())) {
    const before = JSON.stringify(calls)
    if (applyPlan(await planQuestion(message, session, {}, earlier)) && JSON.stringify(calls) !== before) {
      perCall = await Promise.all(calls.map(runCall))
    }
  }
  const toolResults = perCall.flat()
  const intentTools = calls.flatMap((c) => c.tools)
  // "Open the second one" — say which pick this is, so the answer and summary read it that way.
  if (followUp?.type === 'select' && toolResults[0]?.data && typeof toolResults[0].data === 'object') {
    ;(toolResults[0].data as Record<string, unknown>).selection = `#${followUp.position} from your last list (${followUp.ref.label}).`
  }

  const plainLanguage = isPlainLanguagePreferred(message)
  const docs = retrievePlatformDocs(message, 6, plainLanguage)

  // Earlier answers can quote ERP records, so history is withheld along with live data when sending
  // ERP data to the provider is not approved.
  const shareErpData = shouldShareErpData()
  const history: ChatMessage[] = shareErpData
    ? conversation.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    : []

  const contextBlock = buildContextBlock(message, toolResults, docs, input.context?.page, shareErpData)

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(session, profile.customerName, plainLanguage) },
    ...history,
    { role: 'system', content: buildContextPrompt(message, contextBlock, plainLanguage) },
    { role: 'user', content: message },
  ]

  const directReply =
    smallTalk ??
    clarification ??
    askBack ??
    unsupported ??
    (shouldUseDirectCompose(toolResults) ? composeFromToolResults(toolResults) : null)

  return {
    conversationId: conversation.id,
    message,
    intentTools,
    messages,
    links: toolResults
      .flatMap((t) => t.links)
      .filter((l, i, all) => all.findIndex((o) => o.href === l.href && o.label === l.label) === i)
      .slice(0, 8),
    toolsUsed: toolResults.map((t) => t.name),
    docs,
    directReply,
    summarize:
      directReply != null &&
      shouldSummarize(toolResults, {
        modelConfigured: getCelestialModelInfo().configured,
        shareErpData,
        clarification: clarification != null || askBack != null || unsupported != null || smallTalk != null,
      }),
    plainLanguage,
    resultSets: calls.flatMap((call, i) => {
      const { tools: _names, ...callParams } = call
      return buildResultSets(perCall[i] ?? [], callParams, scope)
    }),
    lookups: calls.map((call) => {
      const { tools: names, ...callParams } = call
      return { tool: names.join('+'), params: storeParams(callParams) }
    }),
    routedBy,
  }
}

const POINTS_BACK =
  /\b(it|its|it's|that|this|those|these|them|they|ones?|same|instead|only|just|also|again|more|less|due|when|who|why)\b|^(and|but|now|then|so|great|ok|okay)\b/
const PRONOUN = /\b(it|its|it's|that|this|those|these|them|they)\b/
const OUTSTANDING_WORDS = /\b(unpaid|outstanding|open|owed?|owing|overdue|not (yet )?paid)\b/

/** The lookups behind the most recent answer, ready to run again. */
function lastLookups(messages: Array<{ role: string; metadata: unknown }>): DetectedIntent[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'assistant') continue
    const lookups = (messages[i].metadata as { lookups?: Array<{ tool: string; params: Parameters<typeof loadParams>[0] }> } | null)?.lookups
    if (!lookups?.length) return []
    return lookups.map((l) => ({ ...loadParams(l.params), tools: l.tool.split('+') as DetectedIntent['tools'] }))
  }
  return []
}

/** Earlier questions with the lookups they ran, oldest first, for the router's context. */
function earlierTurns(messages: Array<{ role: string; content: string; metadata: unknown }>): PlannerTurn[] {
  const turns: PlannerTurn[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== 'user') continue
    const next = messages[i + 1]
    const lookups = next?.role === 'assistant' ? (next.metadata as { lookups?: Array<{ tool: string; params: Record<string, unknown> }> } | null)?.lookups : undefined
    turns.push({
      question: messages[i].content.slice(0, 200),
      lookups: (lookups ?? []).map((l) => describeLookup(l.tool, l.params)).join('; '),
    })
  }
  return turns.slice(-3)
}

/** True when a name/product search ran with search words and matched nothing. */
function searchFoundNothing(calls: DetectedIntent[], results: ToolResult[]): boolean {
  const searched = calls.some((c) => (c.searchTokens?.length ?? 0) > 0 || Boolean(c.searchTerm))
  if (!searched) return false
  return results.some((r) => {
    if (r.notice || r.error || !r.data) return false
    const d = r.data as Record<string, unknown>
    if (r.name === 'inventory.stock') return d.matchedSkus === 0
    if (r.name === 'search_catalog') return d.total === 0
    if (r.name === 'sales.by_product') return Array.isArray(d.rows) && d.rows.length === 0 && Boolean(d.search)
    if (r.name === 'global_search') {
      return ['orders', 'customers', 'skus', 'quotes'].every((k) => !Array.isArray(d[k]) || (d[k] as unknown[]).length === 0)
    }
    return false
  })
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
    ...(prepared.resultSets.length > 0 ? { resultSets: prepared.resultSets } : {}),
    ...(prepared.lookups.length > 0 ? { lookups: prepared.lookups } : {}),
    routedBy: prepared.routedBy,
  })
  await touchConversation(prepared.conversationId)

  void auditLog(session.tenantId, {
    action: 'celestial.chat',
    entityType: 'CelestialConversation',
    entityId: prepared.conversationId,
    userId: session.userId,
    metadata: { provider, tools: prepared.toolsUsed },
  }).catch(swallowed('orchestrator.persistChatResult'))
}

/**
 * The records answer, with an AI summary on top when allowed. The server-built evidence is always
 * kept verbatim; a slow, failed or unsupported summary just leaves the evidence on its own.
 */
async function recordsReply(prepared: PreparedChat): Promise<{ reply: string; provider: string; model: string }> {
  const evidence = prepared.directReply ?? ''
  if (!prepared.summarize) return { reply: evidence, provider: 'pleros', model: 'structured' }
  const llm = await withDeadline(
    completeChat(buildSummaryMessages(prepared.message, evidence)),
    summaryTimeoutMs(),
  )
  const summary = acceptSummary(llm?.content, evidence, prepared.message)
  if (!llm || !summary) return { reply: evidence, provider: 'pleros', model: 'structured' }
  return { reply: `${summary}\n\n${evidence}`, provider: llm.provider, model: llm.model }
}

export async function chat(session: SessionUser, input: CelestialChatInput): Promise<CelestialChatResult> {
  const prepared = await prepareChat(session, input)
  if (prepared.directReply) {
    const { reply, provider, model } = await recordsReply(prepared)
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

  let reply: string
  let provider: string
  let model: string
  try {
    if (!getCelestialModelInfo().configured) throw new Error('no model route')
    const llm = await completeChat(prepared.messages)
    reply = finalizeReply(prepared.message, llm.content, prepared.docs, prepared.plainLanguage)
    provider = llm.provider
    model = llm.model
  } catch {
    reply = buildDocFallbackReply(prepared.message, prepared.docs, prepared.plainLanguage)
    provider = 'pleros'
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
          // The summary is checked against the evidence before anything is shown, so it is
          // fetched whole (bounded by the summary deadline) rather than streamed token by token.
          const { reply, provider, model } = await recordsReply(prepared)
          await streamText(reply, provider, model)
          return
        }

        if (!getCelestialModelInfo().configured) {
          await streamText(
            buildDocFallbackReply(prepared.message, prepared.docs, prepared.plainLanguage),
            'pleros',
            'fallback',
          )
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
              'pleros',
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
        } catch (e) {
          if (e instanceof CelestialStreamInterrupted) {
            // The user already saw part of an answer. Finish it with a note instead of appending a
            // second, different answer, and persist exactly what was shown.
            const note = '\n\n_The answer was cut off because the AI provider stopped responding. Please ask again._'
            send('delta', { text: note })
            const shown = e.partial + note
            await persistChatResult(session, prepared, shown, e.cause.provider, 'interrupted')
            send('done', {
              conversationId: prepared.conversationId,
              links: prepared.links,
              toolsUsed: prepared.toolsUsed,
              provider: e.cause.provider,
              model: 'interrupted',
            })
            controller.close()
            return
          }
          await streamText(
            buildDocFallbackReply(prepared.message, prepared.docs, prepared.plainLanguage),
            'pleros',
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
