import { randomUUID } from 'node:crypto'
import { tenantDb } from './db'
import { ApiError } from './session'

export type CreateWebhookInput = {
  event: string
  url: string
  description?: string
}

function toApiShape(row: {
  id: string
  tenantId: string
  event: string
  url: string
  description: string | null
  active: boolean
  createdAt: Date
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    event: row.event,
    url: row.url,
    description: row.description ?? undefined,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listWebhooks(tenantId: string) {
  const rows = await tenantDb.webhookSubscription.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(toApiShape)
}

export async function createWebhook(tenantId: string, dto: CreateWebhookInput) {
  if (!dto.url?.trim() || !dto.event?.trim()) {
    throw new ApiError(400, 'url and event are required')
  }
  try {
    new URL(dto.url)
  } catch {
    throw new ApiError(400, 'url must be a valid URL')
  }

  const row = await tenantDb.webhookSubscription.create({
    data: {
      id: randomUUID(),
      tenantId,
      event: dto.event.trim(),
      url: dto.url.trim(),
      description: dto.description?.trim() || null,
      active: true,
    },
  })
  return toApiShape(row)
}

export async function deleteWebhook(tenantId: string, id: string) {
  const existing = await tenantDb.webhookSubscription.findFirst({ where: { id, tenantId } })
  if (!existing) throw new ApiError(404, 'Webhook subscription not found')
  await tenantDb.webhookSubscription.delete({ where: { id } })
}

export async function testWebhook(tenantId: string, id: string) {
  const sub = await tenantDb.webhookSubscription.findFirst({ where: { id, tenantId } })
  if (!sub) throw new ApiError(404, 'Webhook subscription not found')

  const body = JSON.stringify({
    id: randomUUID(),
    event: 'webhook.test',
    tenantId,
    timestamp: new Date().toISOString(),
    data: { message: 'This is a test webhook from Cosmos.' },
  })

  try {
    const res = await fetch(sub.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cosmos-Event': 'webhook.test' },
      body,
      signal: AbortSignal.timeout(8000),
    })
    return { success: res.ok, status: res.status }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
