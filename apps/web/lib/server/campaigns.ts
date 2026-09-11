import { CampaignStatus } from '@/generated/prisma-tenant'
import { tenantDb, crmDb, orderDb } from './db'
import { ApiError } from './session'
import { NotificationChannel } from '@/generated/prisma-notification'
import * as notifications from './notifications'
import { createUnsubscribeToken, isCustomerSuppressed } from './campaign-unsubscribe'

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

export async function sendCampaign(tenantId: string, campaignId: string) {
  const campaign = await tenantDb.campaign.findFirst({ where: { id: campaignId, tenantId } })
  if (!campaign) throw new ApiError(404, 'Campaign not found')
  if (campaign.status === CampaignStatus.SENT || campaign.status === CampaignStatus.SENDING) {
    throw new ApiError(400, 'Campaign already sent or sending')
  }

  await tenantDb.campaign.update({
    where: { id: campaignId },
    data: { status: CampaignStatus.SENDING },
  })

  const customers = await resolveSegment(tenantId, campaign.segmentId)
  let sentCount = 0
  let suppressedCount = 0

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

    await notifications.send(
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
    sentCount += 1
  }

  await tenantDb.campaign.update({
    where: { id: campaignId },
    data: { status: CampaignStatus.SENT, sentCount },
  })

  return { sentCount, suppressedCount }
}

export async function processScheduledCampaigns(): Promise<{ processed: number; failed: number }> {
  const due = await tenantDb.campaign.findMany({
    where: {
      status: CampaignStatus.SCHEDULED,
      scheduledAt: { lte: new Date() },
    },
  })

  let processed = 0
  let failed = 0

  for (const c of due) {
    try {
      await sendCampaign(c.tenantId, c.id)
      processed += 1
    } catch (err) {
      failed += 1
      console.error(`[campaigns] failed to send scheduled campaign ${c.id}:`, err)
    }
  }

  return { processed, failed }
}

