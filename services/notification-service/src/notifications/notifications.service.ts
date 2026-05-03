import { Injectable } from '@nestjs/common'
import { NotificationStatus, Prisma } from '../generated/prisma-client'
import { PrismaService } from '../prisma/prisma.service'
import { SendNotificationDto } from './dto/send-notification.dto'

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Queue row (always persists first). */
  async enqueue(
    tenantId: string,
    dto: SendNotificationDto,
    idempotencyKey: string | undefined,
  ) {
    if (idempotencyKey) {
      const existing = await this.prisma.notificationRequest.findUnique({
        where: {
          tenantId_idempotencyKey: { tenantId, idempotencyKey },
        },
      })
      if (existing) return existing
    }
    return this.prisma.notificationRequest.create({
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

  /**
   * Stub transport: non-production marks SENT immediately; production stub still marks SENT (no SendGrid).
   */
  async deliverRecord(id: string) {
    const isDevStub = process.env.NODE_ENV !== 'production'
    return this.prisma.notificationRequest.update({
      where: { id },
      data: isDevStub
        ? { status: NotificationStatus.SENT, errorMessage: null }
        : { status: NotificationStatus.SENT, errorMessage: null },
    })
  }

  async send(tenantId: string, dto: SendNotificationDto, idempotencyKey: string | undefined) {
    const row = await this.enqueue(tenantId, dto, idempotencyKey)
    return this.deliverRecord(row.id)
  }

  list(tenantId: string) {
    return this.prisma.notificationRequest.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
  }
}
