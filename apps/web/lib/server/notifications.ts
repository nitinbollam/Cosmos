import { NotificationChannel, NotificationStatus, Prisma } from '@/generated/prisma-notification'
import { notificationDb } from './db'
import { deliverNotification } from './notification-provider'

export type SendNotificationInput = {
  channel: NotificationChannel
  recipient: string
  templateKey: string
  payload?: Record<string, unknown>
}

async function enqueue(tenantId: string, dto: SendNotificationInput, idempotencyKey?: string) {
  if (idempotencyKey) {
    const existing = await notificationDb.notificationRequest.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
    })
    if (existing) return existing
  }
  return notificationDb.notificationRequest.create({
    data: {
      tenantId,
      idempotencyKey: idempotencyKey ?? null,
      channel: dto.channel,
      recipient: dto.recipient,
      templateKey: dto.templateKey,
      payload: (dto.payload ?? {}) as Prisma.InputJsonValue,
      status: NotificationStatus.PENDING,
    },
  })
}

async function deliverRecord(
  tenantId: string,
  id: string,
  dto: SendNotificationInput,
) {
  try {
    const result = await deliverNotification({
      tenantId,
      channel: dto.channel,
      recipient: dto.recipient,
      templateKey: dto.templateKey,
      payload: dto.payload ?? {},
    })
    return notificationDb.notificationRequest.update({
      where: { id, tenantId },
      data: {
        status: NotificationStatus.SENT,
        errorMessage: null,
        payload: {
          ...(dto.payload ?? {}),
          _delivery: { provider: result.provider, subject: result.subject },
        } as Prisma.InputJsonValue,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'delivery failed'
    return notificationDb.notificationRequest.update({
      where: { id, tenantId },
      data: { status: NotificationStatus.FAILED, errorMessage: msg },
    })
  }
}

export async function send(tenantId: string, dto: SendNotificationInput, idempotencyKey?: string) {
  const row = await enqueue(tenantId, dto, idempotencyKey)
  if (row.status === NotificationStatus.SENT) return row
  return deliverRecord(tenantId, row.id, dto)
}

/**
 * At most once per key, ever: only the caller whose insert creates the row delivers it. If any row for the key
 * exists, whatever its status (PENDING may be mid-send, FAILED may have reached the provider before an error),
 * nothing is sent and null is returned. `send` differs: it re-delivers a row that is not SENT.
 */
export async function sendOnce(tenantId: string, dto: SendNotificationInput, idempotencyKey: string) {
  let row
  try {
    row = await notificationDb.notificationRequest.create({
      data: {
        tenantId,
        idempotencyKey,
        channel: dto.channel,
        recipient: dto.recipient,
        templateKey: dto.templateKey,
        payload: (dto.payload ?? {}) as Prisma.InputJsonValue,
        status: NotificationStatus.PENDING,
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null
    throw e
  }
  return deliverRecord(tenantId, row.id, dto)
}

/** Whether a notification with this key was ever recorded (sent, failed or in progress). */
export async function wasAttempted(tenantId: string, idempotencyKey: string) {
  const row = await notificationDb.notificationRequest.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
    select: { id: true },
  })
  return row !== null
}

export function list(tenantId: string, filters?: { recipient?: string; status?: string; channel?: string; event?: string }) {
  const recipient = filters?.recipient?.trim()
  return notificationDb.notificationRequest.findMany({
    where: {
      tenantId,
      ...(recipient ? { recipient } : {}),
      ...(filters?.status ? { status: filters.status as NotificationStatus } : {}),
      ...(filters?.channel ? { channel: filters.channel as NotificationChannel } : {}),
      ...(filters?.event ? { templateKey: filters.event } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
}

export async function retry(tenantId: string, id: string) {
  const row = await notificationDb.notificationRequest.findFirst({ where: { id, tenantId } })
  if (!row) {
    const { ApiError } = await import('./session')
    throw new ApiError(404, 'Notification not found')
  }
  return deliverRecord(tenantId, row.id, {
    channel: row.channel,
    recipient: row.recipient,
    templateKey: row.templateKey,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  })
}
