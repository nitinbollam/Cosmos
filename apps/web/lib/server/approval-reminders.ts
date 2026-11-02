/**
 * Approval notifications (ticket 64): approvers hear when a request arrives, get a reminder once it has waited
 * about 2 days, and tenant admins get an escalation once it has waited about 5. Each stage is claimed with a
 * conditional update on the request (notifiedAt / remindedAt / escalatedAt) before anything is sent, so two
 * server instances or a retried job never send a stage twice, and each email carries an idempotency key.
 */
import { ApprovalStatus, type ApprovalType } from '@/generated/prisma-tenant'
import { NotificationChannel } from '@/generated/prisma-notification'
import { authDb, tenantDb } from './db'
import * as notifications from './notifications'
import { runUnscoped, runWithTenant } from './tenant-scope'

const DAY_MS = 24 * 60 * 60 * 1000
export const REMIND_AFTER_MS = 2 * DAY_MS
export const ESCALATE_AFTER_MS = 5 * DAY_MS
/** Requests looked at per run; the rest are picked up by the next run. */
const BATCH = 200

export type ApprovalStage = 'requested' | 'reminder' | 'escalated'

const STAGE_FIELD = { requested: 'notifiedAt', reminder: 'remindedAt', escalated: 'escalatedAt' } as const

/** Managers and admins can decide approvals; an escalation goes to tenant admins only. */
const STAGE_ROLES: Record<ApprovalStage, Array<'TENANT_ADMIN' | 'MANAGER'>> = {
  requested: ['TENANT_ADMIN', 'MANAGER'],
  reminder: ['TENANT_ADMIN', 'MANAGER'],
  escalated: ['TENANT_ADMIN'],
}

export const APPROVAL_TYPE_LABELS: Record<string, string> = {
  PURCHASE_REQUISITION: 'Purchase requisition',
  PURCHASE_ORDER: 'Purchase order',
  DISCOUNT: 'Discount',
  CREDIT_LIMIT_OVERRIDE: 'Credit limit override',
  EXPENSE_REPORT: 'Expense report',
}

type PendingRow = {
  id: string
  tenantId: string
  type: ApprovalType
  requestedBy: string
  createdAt: Date
  notifiedAt: Date | null
  remindedAt: Date | null
  escalatedAt: Date | null
}

/** The stages a pending request is due for at `now`, earliest first. */
export function dueStages(row: Pick<PendingRow, 'createdAt' | 'notifiedAt' | 'remindedAt' | 'escalatedAt'>, now: Date): ApprovalStage[] {
  const waited = now.getTime() - row.createdAt.getTime()
  const stages: ApprovalStage[] = []
  // A request that is already overdue when first seen only gets the most urgent message, not all three at once.
  if (waited >= ESCALATE_AFTER_MS) {
    if (!row.escalatedAt) stages.push('escalated')
    return stages
  }
  if (waited >= REMIND_AFTER_MS) {
    if (!row.remindedAt) stages.push('reminder')
    return stages
  }
  if (!row.notifiedAt) stages.push('requested')
  return stages
}

async function recipients(tenantId: string, stage: ApprovalStage, requestedBy: string) {
  const users = await authDb.user.findMany({
    where: { tenantId, isActive: true, role: { in: STAGE_ROLES[stage] }, id: { not: requestedBy } },
    select: { id: true, email: true },
  })
  const list = users.filter((u) => u.email?.trim()).map((u) => ({ key: u.id, email: u.email.trim() }))
  if (list.length === 0 && stage === 'escalated') {
    const ops = process.env.PLEROS_OPS_EMAIL?.trim()
    if (ops) list.push({ key: 'ops', email: ops })
  }
  return list
}

async function requesterName(tenantId: string, userId: string): Promise<string> {
  const u = await authDb.user.findFirst({ where: { id: userId, tenantId }, select: { firstName: true, lastName: true, email: true } })
  if (!u) return 'A team member'
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email
}

/** Claims `stage` for this request (only one caller wins) and emails its recipients. Returns emails sent. */
async function sendStage(row: PendingRow, stage: ApprovalStage, now: Date): Promise<number> {
  const field = STAGE_FIELD[stage]
  const claimed = await tenantDb.approvalRequest.updateMany({
    where: { id: row.id, tenantId: row.tenantId, status: ApprovalStatus.PENDING, [field]: null },
    data: { [field]: now },
  })
  if (claimed.count !== 1) return 0

  const to = await recipients(row.tenantId, stage, row.requestedBy)
  if (to.length === 0) return 0
  const payload = {
    approvalId: row.id,
    typeLabel: APPROVAL_TYPE_LABELS[row.type] ?? row.type,
    requestedBy: await requesterName(row.tenantId, row.requestedBy),
    waitingDays: Math.floor((now.getTime() - row.createdAt.getTime()) / DAY_MS),
  }
  let sent = 0
  for (const r of to) {
    try {
      await notifications.send(
        row.tenantId,
        { channel: NotificationChannel.EMAIL, recipient: r.email, templateKey: `approval.${stage}`, payload },
        `approval:${row.id}:${stage}:${r.key}`,
      )
      sent++
    } catch (err) {
      console.error(`[approvals] ${stage} email for ${row.id} failed:`, err)
    }
  }
  return sent
}

const PENDING_SELECT = {
  id: true,
  tenantId: true,
  type: true,
  requestedBy: true,
  createdAt: true,
  notifiedAt: true,
  remindedAt: true,
  escalatedAt: true,
} as const

/** Tells approvers about one new request right away. The job sends it later if this fails or is skipped. */
export async function notifyApprovalRequested(tenantId: string, approvalId: string, now = new Date()) {
  return runWithTenant(tenantId, async () => {
    const row = await tenantDb.approvalRequest.findFirst({
      where: { id: approvalId, tenantId, status: ApprovalStatus.PENDING },
      select: PENDING_SELECT,
    })
    if (!row) return 0
    let sent = 0
    for (const stage of dueStages(row, now)) sent += await sendStage(row, stage, now)
    return sent
  })
}

/** Background job: every pending request that is due a notice, reminder or escalation gets it. */
export async function runApprovalReminders(now = new Date()) {
  const remindBefore = new Date(now.getTime() - REMIND_AFTER_MS)
  const escalateBefore = new Date(now.getTime() - ESCALATE_AFTER_MS)
  const due = await runUnscoped('approval reminders: find pending approvals due a notice in every company', () =>
    tenantDb.approvalRequest.findMany({
      where: {
        status: ApprovalStatus.PENDING,
        OR: [
          { notifiedAt: null, createdAt: { gt: remindBefore } },
          { remindedAt: null, createdAt: { lte: remindBefore, gt: escalateBefore } },
          { escalatedAt: null, createdAt: { lte: escalateBefore } },
        ],
      },
      select: PENDING_SELECT,
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    }),
  )
  const result = { requested: 0, reminder: 0, escalated: 0 }
  for (const row of due) {
    await runWithTenant(row.tenantId, async () => {
      for (const stage of dueStages(row, now)) {
        if ((await sendStage(row, stage, now)) > 0) result[stage]++
      }
    })
  }
  return result
}
