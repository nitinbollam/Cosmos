import { Prisma } from '@/generated/prisma-analytics'
import { analyticsDb } from '../db'
import { ApiError } from '../session'

export async function getOrCreateConversation(
  tenantId: string,
  userId: string,
  role: string,
  surface: string,
  conversationId?: string,
) {
  if (conversationId) {
    const existing = await analyticsDb.celestialConversation.findFirst({
      where: { id: conversationId, tenantId, userId },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
    })
    if (!existing) throw new ApiError(404, 'Conversation not found')
    return existing
  }

  return analyticsDb.celestialConversation.create({
    data: { tenantId, userId, role, surface, title: 'Celestial chat' },
    include: { messages: true },
  })
}

export async function appendMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  metadata?: Record<string, unknown>,
) {
  return analyticsDb.celestialMessage.create({
    data: {
      conversationId,
      role,
      content,
      metadata: (metadata ?? {}) as Prisma.InputJsonValue,
    },
  })
}

export async function listConversations(tenantId: string, userId: string, limit = 10) {
  return analyticsDb.celestialConversation.findMany({
    where: { tenantId, userId },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
}

export async function touchConversation(conversationId: string) {
  await analyticsDb.celestialConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  })
}
