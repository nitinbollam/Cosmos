import { createHmac, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { tenantDb } from './db'
import { ApiError } from './session'

export type CreateWebhookInput = {
  event: string
  url: string
  description?: string
}

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip === '0.0.0.0') return true
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true
  const v4 = ip.replace(/^::ffff:/, '')
  const parts = v4.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false
  const [a, b] = parts
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) // link-local / cloud metadata
  )
}

/** SSRF guard: webhook targets must be public https endpoints, never internal hosts. */
export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ApiError(400, 'url must be a valid URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ApiError(400, 'Webhook URL must be http(s)')
  }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ApiError(400, 'Webhook URL cannot target internal hosts')
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new ApiError(400, 'Webhook URL cannot target private IP ranges')
    return url
  }
  try {
    const addrs = await lookup(host, { all: true })
    if (addrs.some((a) => isPrivateIp(a.address))) {
      throw new ApiError(400, 'Webhook URL resolves to a private IP range')
    }
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(400, 'Webhook URL host could not be resolved')
  }
  return url
}

/** Sign outbound payloads so receivers can verify origin. */
export function signWebhookPayload(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function webhookSigningSecret(tenantId: string): string {
  const base = process.env.WEBHOOK_SIGNING_SECRET?.trim() || 'cosmos-webhook-signing'
  return `${base}:${tenantId}`
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
    // Re-validate at send time: DNS may have changed since the subscription was created.
    await assertSafeWebhookUrl(sub.url)
    const res = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cosmos-Event': 'webhook.test',
        'X-Cosmos-Signature': signWebhookPayload(webhookSigningSecret(tenantId), body),
      },
      body,
      signal: AbortSignal.timeout(8000),
    })
    return { success: res.ok, status: res.status }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
