import { createHmac, randomUUID } from 'node:crypto'
import { tenantDb } from './db'
import { assertPublicHttpsUrl, postToPublicUrl, type ResolveHost } from './safe-outbound'
import { ApiError } from './session'

export type CreateWebhookInput = {
  event: string
  url: string
  description?: string
}

/** SSRF guard: webhook targets must be public https endpoints, never internal hosts. */
export function assertSafeWebhookUrl(raw: string, resolve?: ResolveHost): Promise<URL> {
  return assertPublicHttpsUrl(raw, 'Webhook URL', resolve)
}

/** POST a webhook and return the HTTP status (a redirect is never followed, so a 3xx is a failure). */
export async function deliverWebhook(
  url: URL,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  resolve?: ResolveHost,
): Promise<number> {
  return (await postToPublicUrl(url, headers, body, timeoutMs, resolve)).status
}

/** Sign outbound payloads so receivers can verify origin. */
export function signWebhookPayload(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

export function webhookSigningSecret(tenantId: string): string {
  const base = process.env.WEBHOOK_SIGNING_SECRET?.trim()
  if (base) return `${base}:${tenantId}`
  // The development fallback is in the source, so a signature made with it proves nothing.
  if (process.env.NODE_ENV === 'production') throw new Error('WEBHOOK_SIGNING_SECRET is not configured')
  return `pleros-webhook-signing:${tenantId}`
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
  await assertSafeWebhookUrl(dto.url.trim())

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
  // Its queued retries must not be sent, and its log goes with it.
  await tenantDb.webhookDelivery.deleteMany({ where: { tenantId, subscriptionId: id } })
}

/** The most recent deliveries of one webhook, newest first — what was sent and how it went. */
export async function listWebhookDeliveries(tenantId: string, subscriptionId: string, limit = 25) {
  const existing = await tenantDb.webhookSubscription.findFirst({ where: { id: subscriptionId, tenantId } })
  if (!existing) throw new ApiError(404, 'Webhook subscription not found')
  const rows = await tenantDb.webhookDelivery.findMany({
    where: { tenantId, subscriptionId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  })
  return rows.map((r) => ({
    id: r.id,
    event: r.event,
    status: r.status,
    attempts: r.attempts,
    lastStatusCode: r.lastStatusCode,
    lastError: r.lastError,
    nextAttemptAt: r.status === 'PENDING' ? r.nextAttemptAt.toISOString() : null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    body: r.body,
  }))
}

export async function testWebhook(tenantId: string, id: string) {
  const sub = await tenantDb.webhookSubscription.findFirst({ where: { id, tenantId } })
  if (!sub) throw new ApiError(404, 'Webhook subscription not found')

  const body = JSON.stringify({
    id: randomUUID(),
    event: 'webhook.test',
    tenantId,
    timestamp: new Date().toISOString(),
    data: { message: 'This is a test webhook from Pleros.' },
  })

  try {
    // Re-validate at send time: DNS may have changed since the subscription was created.
    const url = await assertSafeWebhookUrl(sub.url)
    const status = await deliverWebhook(
      url,
      {
        'Content-Type': 'application/json',
        'X-Pleros-Event': 'webhook.test',
        'X-Pleros-Signature': signWebhookPayload(webhookSigningSecret(tenantId), body),
      },
      body,
      8000,
    )
    return { success: status >= 200 && status < 300, status }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

