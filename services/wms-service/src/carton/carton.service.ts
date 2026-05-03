import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Trace } from '@cosmos/tracing'
import { PrismaService } from '../prisma/prisma.service'
import { ShippingLabelService } from './shipping-label.service'
import type { AddCartonItemDto, CreateCartonDto, SealCartonDto } from './dto/carton.dto'

@Injectable()
export class CartonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly labels: ShippingLabelService,
  ) {}

  @Trace()
  async createCarton(tenantId: string, taskId: string, dto: CreateCartonDto) {
    const task = await this.prisma.fulfillmentTask.findFirst({
      where: { id: taskId, tenantId },
    })
    if (!task) throw new NotFoundException('Fulfillment task not found')

    const count = await this.prisma.carton.count({ where: { taskId } })
    return this.prisma.carton.create({
      data: {
        tenantId,
        taskId,
        cartonNumber: count + 1,
        weightGrams: dto.weightGrams ?? null,
        lengthCm: dto.lengthCm ?? null,
        widthCm: dto.widthCm ?? null,
        heightCm: dto.heightCm ?? null,
      },
    })
  }

  @Trace()
  async addItemToCarton(tenantId: string, cartonId: string, dto: AddCartonItemDto) {
    const carton = await this.prisma.carton.findFirst({
      where: { id: cartonId, tenantId },
    })
    if (!carton) throw new NotFoundException('Carton not found')

    const existing = await this.prisma.cartonItem.findFirst({
      where: { cartonId, skuId: dto.skuId },
    })
    if (existing) {
      return this.prisma.cartonItem.update({
        where: { id: existing.id },
        data: { quantity: { increment: dto.quantity } },
      })
    }
    return this.prisma.cartonItem.create({
      data: {
        cartonId,
        skuId: dto.skuId,
        quantity: dto.quantity,
      },
    })
  }

  @Trace()
  async sealCarton(tenantId: string, cartonId: string, dto: SealCartonDto) {
    const carton = await this.prisma.carton.findFirst({
      where: { id: cartonId, tenantId },
      include: { items: true },
    })
    if (!carton) throw new NotFoundException('Carton not found')
    if (!carton.items.length) throw new BadRequestException('Cannot seal an empty carton')

    const { trackingNum, labelUrl } = this.labels.issueLabel(dto.carrier, dto.serviceLevel)
    return this.prisma.carton.update({
      where: { id: cartonId },
      data: {
        carrier: dto.carrier,
        trackingNum,
        labelUrl,
        sealedAt: new Date(),
      },
      include: { items: true },
    })
  }

  @Trace()
  async listCartonsForTask(tenantId: string, taskId: string) {
    const task = await this.prisma.fulfillmentTask.findFirst({
      where: { id: taskId, tenantId },
    })
    if (!task) throw new NotFoundException('Fulfillment task not found')
    return this.prisma.carton.findMany({
      where: { tenantId, taskId },
      include: { items: true },
      orderBy: { cartonNumber: 'asc' },
    })
  }
}
