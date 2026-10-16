/**
 * Domain events: things that happened in the business (an order shipped, a batch recalled) that a
 * tenant can subscribe to with webhooks — how Pleros feeds customers' other systems.
 *
 * emitDomainEvent never fails or slows down the action that caused it. It records one delivery
 * per matching subscription, tries each once straight away in the background, and the background
 * job retries failures with backoff. The body is stored once and resent unchanged, so receivers can
 * dedupe on its `id` (also sent as X-Pleros-Delivery per subscription).
 */
import { randomUUID } from 'node:crypto'
import { tenantDb } from './db'

/** Wait after attempt 1, 2, … before the next one. After the last, the delivery is given up (~21 h). */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000]
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1
/** While one sender holds a delivery, nobody else picks it up. Longer than any single attempt. */
const LEASE_MS = 2 * 60_000
const SEND_TIMEOUT_MS = 10_000
/**
 * First attempts run straight away up to this many at once. A burst beyond it (say, a bulk customer
 * import with an "All events" webhook) is left to the background job, which sends one at a time,
 * instead of opening hundreds of connections to the tenant's endpoint.
 */
export const MAX_IMMEDIATE_ATTEMPTS = 5
/** Finished deliveries are kept this long for the delivery log. */
const KEEP_FINISHED_MS = 30 * 24 * 3_600_000

export type EmitOptions = {
  /**
   * Identifies the business occurrence (e.g. the fulfillment task for order.shipped), so the same
   * occurrence reaches each subscription once however often the code path runs. Leave it out for
   * events that genuinely repeat (low stock, payments without an id).
   */
  key?: string
}

/** Sends one request and returns the HTTP status. Swapped out in tests. */
export type WebhookTransport = (url: URL, headers: Record<string, string>, body: string) => Promise<number>

const defaultTransport: WebhookTransport = async (url, headers, body) => {
  const { deliverWebhook } = await import('./webhooks')
  return deliverWebhook(url, headers, body, SEND_TIMEOUT_MS)
}
let transport: WebhookTransport = defaultTransport
/** First attempts still running in the background (tests wait on these). */
const inFlight = new Set<Promise<void>>()

/** Tests swap how requests leave the server; `null` restores the real one. */
export function useWebhookTransport(next: WebhookTransport | null) {
  transport = next ?? defaultTransport
}

function isUniqueViolation(e: unknown) {
  return Boolean(e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002')
}

/**
 * Queue `event` for every active subscription to it (or to all events, `*`) and start sending.
 * Call after the change it describes has been saved. Never throws.
 */
export async function emitDomainEvent(
  tenantId: string,
  event: string,
  data: Record<string, unknown>,
  options: EmitOptions = {},
): Promise<void> {
  try {
    const subscriptions = await tenantDb.webhookSubscription.findMany({
      where: { tenantId, active: true, event: { in: [event, '*'] } },
      select: { id: true },
    })
    if (subscriptions.length === 0) return

    // Same shape as the test webhook, so receivers built against "Send test" keep working.
    const body = JSON.stringify({ id: randomUUID(), event, tenantId, timestamp: new Date().toISOString(), data })
    const eventKey = options.key ? `${event}:${options.key}` : null
    const queued: string[] = []
    for (const { id: subscriptionId } of subscriptions) {
      try {
        const row = await tenantDb.webhookDelivery.create({ data: { tenantId, subscriptionId, event, eventKey, body } })
        queued.push(row.id)
      } catch (e) {
        if (!isUniqueViolation(e)) throw e // already delivered (or queued) for this occurrence
      }
    }
    if (queued.length > 0 && inFlight.size < MAX_IMMEDIATE_ATTEMPTS) {
      const first = (async () => {
        for (const id of queued) await attemptDelivery(id)
      })()
        .catch((err) => console.error(`[webhooks] first attempt for ${event} failed:`, err))
        .finally(() => inFlight.delete(first))
      inFlight.add(first)
    }
  } catch (err) {
    console.error(`[webhooks] could not queue ${event} for tenant ${tenantId}:`, err)
  }
}

/** Wait for first attempts started by emitDomainEvent (for tests and graceful shutdown). */
export async function settleWebhookAttempts(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight])
}

/**
 * Send one delivery if it is due and nobody else is sending it. Records the outcome: delivered on
 * a 2xx, otherwise the next retry (or give up after MAX_ATTEMPTS). Any non-2xx is a failure,
 * including redirects, which are never followed.
 */
export async function attemptDelivery(id: string): Promise<void> {
  const now = new Date()
  // Claim it: the immediate attempt and the background sweep can reach the same row.
  const claimed = await tenantDb.webhookDelivery.updateMany({
    where: { id, status: 'PENDING', nextAttemptAt: { lte: now } },
    data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  })
  if (claimed.count !== 1) return

  const delivery = await tenantDb.webhookDelivery.findUnique({ where: { id } })
  if (!delivery) return
  const subscription = await tenantDb.webhookSubscription.findFirst({
    where: { id: delivery.subscriptionId, tenantId: delivery.tenantId },
  })
  if (!subscription?.active) {
    await tenantDb.webhookDelivery.update({
      where: { id },
      data: { status: 'FAILED', lastError: 'The webhook was removed or turned off' },
    })
    return
  }

  const attempts = delivery.attempts + 1
  let statusCode: number | null = null
  let error: string | null = null
  try {
    const { assertSafeWebhookUrl, signWebhookPayload, webhookSigningSecret } = await import('./webhooks')
    const url = await assertSafeWebhookUrl(subscription.url)
    statusCode = await transport(
      url,
      {
        'Content-Type': 'application/json',
        'X-Pleros-Event': delivery.event,
        'X-Pleros-Delivery': delivery.id,
        'X-Pleros-Attempt': String(attempts),
        'X-Pleros-Signature': signWebhookPayload(webhookSigningSecret(delivery.tenantId), delivery.body),
      },
      delivery.body,
    )
    if (statusCode >= 200 && statusCode < 300) {
      await tenantDb.webhookDelivery.update({
        where: { id },
        data: { status: 'DELIVERED', attempts, lastStatusCode: statusCode, lastError: null, deliveredAt: new Date() },
      })
      return
    }
    error = `Endpoint answered ${statusCode}`
  } catch (e) {
    error = e instanceof Error ? e.message : 'Delivery failed'
  }

  const giveUp = attempts >= MAX_ATTEMPTS
  await tenantDb.webhookDelivery.update({
    where: { id },
    data: {
      attempts,
      lastStatusCode: statusCode,
      lastError: error,
      status: giveUp ? 'FAILED' : 'PENDING',
      nextAttemptAt: giveUp ? new Date() : new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]!),
    },
  })
}

let sweeping = false

/**
 * Background job: retry due deliveries (a bounded batch per pass) and prune old finished ones.
 * A pass that is still running when the next starts is left alone rather than doubled up.
 */
export async function processDueWebhookDeliveries(limit = 25): Promise<{ attempted: number; pruned: number }> {
  if (sweeping) return { attempted: 0, pruned: 0 }
  sweeping = true
  try {
    const due = await tenantDb.webhookDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      select: { id: true },
    })
    for (const { id } of due) {
      await attemptDelivery(id).catch((err) => console.error(`[webhooks] delivery ${id} attempt failed:`, err))
    }
    const { count: pruned } = await tenantDb.webhookDelivery.deleteMany({
      where: { status: { in: ['DELIVERED', 'FAILED'] }, updatedAt: { lt: new Date(Date.now() - KEEP_FINISHED_MS) } },
    })
    return { attempted: due.length, pruned }
  } finally {
    sweeping = false
  }
}

async function hasSubscribers(tenantId: string, event: string): Promise<boolean> {
  const count = await tenantDb.webhookSubscription.count({
    where: { tenantId, active: true, event: { in: [event, '*'] } },
  })
  return count > 0
}

/**
 * Order events carry the order's summary, read when the event is recorded; events tied to a status
 * (shipped, delivered, …) pass it in `extra`, since a fast follow-up change (a POS sale is shipped
 * and delivered at once) could otherwise show through. The order is only read when someone
 * subscribes, so tenants without webhooks pay nothing. Never throws.
 */
export async function emitOrderEvent(
  tenantId: string,
  event: string,
  orderId: string,
  extra: Record<string, unknown> = {},
  options: EmitOptions = {},
): Promise<void> {
  try {
    if (!(await hasSubscribers(tenantId, event))) return
    const { orderDb } = await import('./db')
    const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
    if (!order) return
    await emitDomainEvent(
      tenantId,
      event,
      {
        orderId: order.id,
        status: order.status,
        customerId: order.customerId,
        channel: order.channel,
        paymentMethod: order.paymentMethod,
        totalAmount: Number(order.totalAmount),
        amountPaid: Number(order.amountPaid ?? 0),
        placedAt: order.createdAt.toISOString(),
        ...extra,
      },
      options,
    )
  } catch (err) {
    console.error(`[webhooks] could not emit ${event} for order ${orderId}:`, err)
  }
}
