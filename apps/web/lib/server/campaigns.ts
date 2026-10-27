import { CampaignStatus } from '@/generated/prisma-tenant'
import { tenantDb, crmDb, orderDb } from './db'
import { ApiError } from './session'
import { NotificationChannel, NotificationStatus } from '@/generated/prisma-notification'
import * as notifications from './notifications'
import { createUnsubscribeToken, isCustomerSuppressed } from './campaign-unsubscribe'
import { runUnscoped, runWithTenant } from './tenant-scope'

export type SegmentFilter = {
  minDaysSinceLastOrder?: number
  minLifetimeSpend?: number
  hasNoOrdersEver?: boolean
}

export async function createSegment(
  tenantId: string,
  input: { name: string; filterCriteria: SegmentFilter },
) {
  if (!input.name.trim()) throw new ApiError(400, 'Segment name required')
  return tenantDb.customerSegment.create({
    data: {
      tenantId,
      name: input.name.trim(),
      filterCriteria: input.filterCriteria as never,
    },
  })
}

export async function listSegments(tenantId: string) {
  return tenantDb.customerSegment.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  })
}

async function customerLifetimeSpend(tenantId: string, customerId: string): Promise<number> {
  const orders = await orderDb.order.findMany({
    where: { tenantId, customerId, status: { notIn: ['CANCELLED', 'FAILED'] } },
    select: { totalAmount: true },
  })
  return orders.reduce((s, o) => s + Number(o.totalAmount), 0)
}

async function daysSinceLastOrder(tenantId: string, customerId: string): Promise<number | null> {
  const last = await orderDb.order.findFirst({
    where: { tenantId, customerId, status: { notIn: ['CANCELLED', 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (!last) return null
  return (Date.now() - last.createdAt.getTime()) / (24 * 60 * 60 * 1000)
}

export async function resolveSegment(tenantId: string, segmentId: string) {
  const segment = await tenantDb.customerSegment.findFirst({ where: { id: segmentId, tenantId } })
  if (!segment) throw new ApiError(404, 'Segment not found')

  const criteria = segment.filterCriteria as SegmentFilter
  const customers = await crmDb.customer.findMany({ where: { tenantId } })
  const matched = []
  const hasFilters =
    criteria.hasNoOrdersEver ||
    criteria.minLifetimeSpend != null ||
    criteria.minDaysSinceLastOrder != null

  for (const c of customers) {
    const spend = await customerLifetimeSpend(tenantId, c.id)
    const days = await daysSinceLastOrder(tenantId, c.id)
    const hasOrders = days != null

    if (criteria.hasNoOrdersEver) {
      if (!hasOrders) matched.push(c)
      continue
    }

    if (!hasFilters) {
      matched.push(c)
      continue
    }

    if (criteria.minLifetimeSpend != null && spend < criteria.minLifetimeSpend) continue
    if (criteria.minDaysSinceLastOrder != null) {
      if (!hasOrders || days < criteria.minDaysSinceLastOrder) continue
    }

    matched.push(c)
  }

  return matched
}

export async function previewSegmentCount(tenantId: string, segmentId: string) {
  const customers = await resolveSegment(tenantId, segmentId)
  let suppressed = 0
  for (const c of customers) {
    if (await isCustomerSuppressed(tenantId, c.id, c.email)) suppressed += 1
  }
  return { total: customers.length, sendable: customers.length - suppressed, suppressed }
}

export async function createCampaign(
  tenantId: string,
  input: { name: string; segmentId: string; subject: string; body: string; scheduledAt?: string | null },
) {
  await tenantDb.customerSegment.findFirstOrThrow({ where: { id: input.segmentId, tenantId } })
  return tenantDb.campaign.create({
    data: {
      tenantId,
      name: input.name.trim(),
      segmentId: input.segmentId,
      subject: input.subject.trim(),
      body: input.body,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      status: input.scheduledAt ? CampaignStatus.SCHEDULED : CampaignStatus.DRAFT,
    },
  })
}

export async function listCampaigns(tenantId: string) {
  return tenantDb.campaign.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  })
}

function appOrigin(): string {
  return process.env.APP_URL?.trim() || process.env.PLEROS_CLIENT_ORIGIN?.trim() || 'http://localhost:4000'
}

/** A send that started this long ago and is still SENDING was interrupted (e.g. the server restarted). */
export const STUCK_SENDING_MS = 30 * 60 * 1000

/** Statuses a fresh send can start from. */
const SENDABLE: CampaignStatus[] = [CampaignStatus.DRAFT, CampaignStatus.SCHEDULED]

/**
 * How a send that ran to the end is recorded. Every email failed → FAILED, so it can't pass for
 * sent; some failed → SENT with the failures counted and Retry available; none failed → SENT.
 */
export function campaignOutcome(result: { delivered: number; failed: number; firstError?: string | null }): {
  status: CampaignStatus
  lastError: string | null
} {
  const reason = result.firstError?.trim() || 'the email provider refused it'
  const n = result.failed
  if (n > 0 && result.delivered === 0) {
    return { status: CampaignStatus.FAILED, lastError: `None of the ${n} email${n === 1 ? ' was' : 's were'} delivered: ${reason}` }
  }
  if (n > 0) return { status: CampaignStatus.SENT, lastError: `${n} email${n === 1 ? '' : 's'} failed: ${reason}` }
  return { status: CampaignStatus.SENT, lastError: null }
}

/** Whether Retry applies: a failed send, or a sent campaign some customers didn't get. */
export function canRetryCampaign(c: { status: CampaignStatus; failedCount: number }): boolean {
  return c.status === CampaignStatus.FAILED || (c.status === CampaignStatus.SENT && c.failedCount > 0)
}

/**
 * Send a campaign, or with `retry` send it again after a failure. Each customer's email has its own
 * idempotency key, so a retry skips everyone already emailed and only resends the failures.
 */
export async function sendCampaign(tenantId: string, campaignId: string, opts: { retry?: boolean } = {}) {
  const campaign = await tenantDb.campaign.findFirst({ where: { id: campaignId, tenantId } })
  if (!campaign) throw new ApiError(404, 'Campaign not found')
  if (campaign.status === CampaignStatus.SENDING) throw new ApiError(409, 'Campaign is already sending')
  if (opts.retry ? !canRetryCampaign(campaign) : !SENDABLE.includes(campaign.status)) {
    throw new ApiError(400, opts.retry ? 'Only a failed campaign, or one some customers didn’t get, can be retried' : 'Campaign already sent')
  }

  // Claim it atomically: the 5-minute job and a manual Send can't both start the same campaign.
  const claimed = await tenantDb.campaign.updateMany({
    where: { id: campaignId, tenantId, status: campaign.status },
    data: { status: CampaignStatus.SENDING, sendStartedAt: new Date(), lastError: null },
  })
  if (claimed.count === 0) throw new ApiError(409, 'Campaign is already sending')

  let delivered = 0
  let failed = 0
  let suppressedCount = 0
  let firstError: string | null = null
  try {
    const customers = await resolveSegment(tenantId, campaign.segmentId)
    for (const customer of customers) {
      if (!customer.email?.trim()) {
        suppressedCount += 1
        continue
      }
      if (await isCustomerSuppressed(tenantId, customer.id, customer.email)) {
        suppressedCount += 1
        continue
      }

      const token = createUnsubscribeToken(tenantId, customer.id)
      const unsubscribeUrl = `${appOrigin()}/unsubscribe?token=${encodeURIComponent(token)}`
      const body = `${campaign.body}\n\n---\nUnsubscribe: ${unsubscribeUrl}`

      const sent = await notifications.send(
        tenantId,
        {
          channel: NotificationChannel.EMAIL,
          recipient: customer.email.trim(),
          templateKey: `campaign.${campaign.id}`,
          payload: {
            subject: campaign.subject,
            body,
            customerName: customer.name,
            campaignId: campaign.id,
          },
        },
        `campaign:${campaign.id}:${customer.id}`,
      )
      if (sent.status === NotificationStatus.SENT) {
        delivered += 1
      } else {
        failed += 1
        firstError ??= sent.errorMessage ?? null
      }
    }
  } catch (err) {
    // Stopped part-way: record it so the campaign isn't stuck in SENDING, then let the caller see it.
    const reason = err instanceof Error && err.message ? err.message : 'unexpected error'
    const attempted = delivered + failed
    await tenantDb.campaign.updateMany({
      where: { id: campaignId, tenantId },
      data: {
        status: CampaignStatus.FAILED,
        sentCount: delivered,
        failedCount: failed,
        lastError: `Sending stopped after ${attempted} email${attempted === 1 ? '' : 's'}: ${reason}`.slice(0, 500),
      },
    })
    throw err
  }

  const outcome = campaignOutcome({ delivered, failed, firstError })
  await tenantDb.campaign.updateMany({
    where: { id: campaignId, tenantId },
    data: { status: outcome.status, sentCount: delivered, failedCount: failed, lastError: outcome.lastError?.slice(0, 500) ?? null },
  })

  return { status: outcome.status, sentCount: delivered, failedCount: failed, suppressedCount, lastError: outcome.lastError }
}

/**
 * Background job (every 5 minutes): mark interrupted sends as failed, then send every scheduled
 * campaign whose time has come.
 */
export async function processScheduledCampaigns(now = new Date()): Promise<{ processed: number; failed: number; interrupted: number }> {
  const stuckBefore = new Date(now.getTime() - STUCK_SENDING_MS)
  const interrupted = await runUnscoped('campaign job: mark interrupted sends in every company', () =>
    tenantDb.campaign.updateMany({
      where: {
        status: CampaignStatus.SENDING,
        OR: [{ sendStartedAt: { lt: stuckBefore } }, { sendStartedAt: null, createdAt: { lt: stuckBefore } }],
      },
      data: {
        status: CampaignStatus.FAILED,
        lastError: 'Sending was interrupted before it finished. Retry to send to the customers who didn’t get it.',
      },
    }),
  )

  const due = await runUnscoped('campaign job: find scheduled campaigns that are due in every company', () =>
    tenantDb.campaign.findMany({ where: { status: CampaignStatus.SCHEDULED, scheduledAt: { lte: now } } }),
  )

  let processed = 0
  let failed = 0

  for (const c of due) {
    try {
      await runWithTenant(c.tenantId, () => sendCampaign(c.tenantId, c.id))
      processed += 1
    } catch (err) {
      failed += 1
      console.error(`[campaigns] failed to send scheduled campaign ${c.id}:`, err)
    }
  }

  return { processed, failed, interrupted: interrupted.count }
}
