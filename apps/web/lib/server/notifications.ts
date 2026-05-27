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
      where: { id },
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
      where: { id },
      data: { status: NotificationStatus.FAILED, errorMessage: msg },
    })
  }
}

export async function send(tenantId: string, dto: SendNotificationInput, idempotencyKey?: string) {
  const row = await enqueue(tenantId, dto, idempotencyKey)
  if (row.status === NotificationStatus.SENT) return row
  return deliverRecord(tenantId, row.id, dto)
}

export function list(tenantId: string) {
  return notificationDb.notificationRequest.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
}
