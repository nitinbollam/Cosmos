import { createHmac, randomUUID } from 'node:crypto'
import { lookup, type LookupAddress } from 'node:dns'
import { request } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { tenantDb } from './db'
import { ApiError } from './session'

export type CreateWebhookInput = {
  event: string
  url: string
  description?: string
}

/** Resolves a host name to every address it points at. Swappable in tests. */
export type ResolveHost = (host: string) => Promise<LookupAddress[]>

const resolveHost: ResolveHost = (host) =>
  new Promise((resolve, reject) =>
    lookup(host, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))),
  )

/**
 * Addresses a webhook may never reach: this machine, private networks, link-local (cloud
 * metadata), carrier-grade NAT (some hosts' internal networks), multicast and reserved ranges.
 * IPv4-mapped, IPv4-compatible and NAT64 IPv6 forms are blocked whole so they can't smuggle one in.
 */
const BLOCKED_IPV4 = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_IPV4.addSubnet(network, prefix, 'ipv4')
}
// Kept apart from the IPv4 list: newer Node versions match IPv4 addresses against IPv6 rules
// (so a ::ffff:0:0/96 rule there would block every IPv4 address).
const BLOCKED_IPV6 = new BlockList()
for (const [network, prefix] of [
  ['::', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED_IPV6.addSubnet(network, prefix, 'ipv6')
}

/** True for any address a webhook must not reach (anything that isn't an IP counts as blocked). */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return BLOCKED_IPV4.check(ip, 'ipv4')
  if (family === 6) return BLOCKED_IPV6.check(ip, 'ipv6')
  return true
}

/** URL host without the brackets URLs put around IPv6 literals. */
function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

/** SSRF guard: webhook targets must be public https endpoints, never internal hosts. */
export async function assertSafeWebhookUrl(raw: string, resolve: ResolveHost = resolveHost): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ApiError(400, 'url must be a valid URL')
  }
  if (url.protocol !== 'https:') {
    throw new ApiError(400, 'Webhook URL must use https')
  }
  const host = bareHost(url)
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ApiError(400, 'Webhook URL cannot target internal hosts')
  }
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new ApiError(400, 'Webhook URL cannot target private IP ranges')
    return url
  }
  let addresses: LookupAddress[]
  try {
    addresses = await resolve(host)
  } catch {
    throw new ApiError(400, 'Webhook URL host could not be resolved')
  }
  if (addresses.length === 0) throw new ApiError(400, 'Webhook URL host could not be resolved')
  if (addresses.some((a) => isBlockedAddress(a.address))) {
    throw new ApiError(400, 'Webhook URL resolves to a private IP range')
  }
  return url
}

/**
 * DNS lookup for the webhook connection itself. The name is resolved again here, as the socket
 * opens, so a host that answered with a public address during validation can't switch to an
 * internal one for the real request. Handles both callback forms Node uses (`all` or single).
 */
export function guardedLookup(resolve: ResolveHost = resolveHost): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname)
      .then((addresses) => {
        if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
          throw new ApiError(400, 'Webhook URL resolves to a private IP range')
        }
        const family = typeof options.family === 'number' ? options.family : 0
        const usable = family ? addresses.filter((a) => a.family === family) : addresses
        if (usable.length === 0) throw new ApiError(400, 'Webhook URL host could not be resolved')
        if (options.all) callback(null, usable)
        else callback(null, usable[0]!.address, usable[0]!.family)
      })
      .catch((err: NodeJS.ErrnoException) => callback(err, ''))
  }
}

/**
 * POST a payload to a validated webhook URL and return the HTTP status. Redirects are never
 * followed — a 3xx is just a failed delivery — so a public endpoint can't bounce the request to an
 * internal address. IP-literal hosts skip DNS entirely, so they're checked here too.
 */
export async function deliverWebhook(
  url: URL,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  resolve: ResolveHost = resolveHost,
): Promise<number> {
  const host = bareHost(url)
  if (url.protocol !== 'https:' || (isIP(host) && isBlockedAddress(host))) {
    throw new ApiError(400, 'Webhook URL cannot target private IP ranges')
  }
  return new Promise((done, fail) => {
    const req = request(
      {
        hostname: host,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        lookup: guardedLookup(resolve),
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        res.resume()
        done(res.statusCode ?? 0)
      },
    )
    req.on('error', fail)
    req.end(body)
  })
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

export async function triggerWebhook(tenantId: string, event: string, payload: Record<string, unknown>) {
  const subs = await tenantDb.webhookSubscription.findMany({
    where: { tenantId, event, active: true },
  })
  if (subs.length === 0) return { dispatched: 0 }

  const body = JSON.stringify({
    id: randomUUID(),
    event,
    tenantId,
    timestamp: new Date().toISOString(),
    data: payload,
  })

  let count = 0
  for (const sub of subs) {
    try {
      const url = await assertSafeWebhookUrl(sub.url)
      await deliverWebhook(
        url,
        {
          'Content-Type': 'application/json',
          'X-Pleros-Event': event,
          'X-Pleros-Signature': signWebhookPayload(webhookSigningSecret(tenantId), body),
        },
        body,
        5000,
      )
      count++
    } catch {
      // Ignore background dispatch errors
    }
  }
  return { dispatched: count }
}

