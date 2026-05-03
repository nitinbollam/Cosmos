import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, RouteStatus, StopStatus } from '../generated/prisma-client'
import { PrismaService } from '../prisma/prisma.service'
import { AssignDriverDto } from './dto/assign-driver.dto'
import { CreateRouteDto } from './dto/create-route.dto'
import { logger } from '@cosmos/logger'

@Injectable()
export class RoutesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.deliveryRoute.findMany({
      where: { tenantId },
      include: { stops: { orderBy: { sequence: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.deliveryRoute.findFirst({
      where: { id, tenantId },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    })
    if (!row) throw new NotFoundException('Route not found')
    return row
  }

  async create(tenantId: string, dto: CreateRouteDto) {
    const seqs = new Set(dto.stops.map((s) => s.sequence))
    if (seqs.size !== dto.stops.length) throw new BadRequestException('Duplicate stop sequence')
    return this.prisma.deliveryRoute.create({
      data: {
        tenantId,
        name: dto.name,
        status: RouteStatus.PLANNED,
        stops: {
          create: dto.stops.map((s) => ({
            sequence: s.sequence,
            address: s.address as Prisma.InputJsonValue,
          })),
        },
      },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    })
  }

  async assignDriver(tenantId: string, id: string, dto: AssignDriverDto) {
    const route = await this.get(tenantId, id)
    if (route.status === RouteStatus.CANCELLED || route.status === RouteStatus.COMPLETED) {
      throw new BadRequestException('Route is not assignable')
    }
    return this.prisma.deliveryRoute.update({
      where: { id },
      data: {
        driverId: dto.driverId,
        status: RouteStatus.IN_PROGRESS,
      },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    })
  }

  /** Mobile / telemetry — log driver GPS (persist to DB when product needs live maps). */
  recordDriverLocation(
    tenantId: string,
    body: { lat: number; lng: number; timestamp?: string },
  ): { ok: boolean } {
    logger.info(
      { tenantId, lat: body.lat, lng: body.lng, at: body.timestamp ?? new Date().toISOString() },
      'driver location',
    )
    return { ok: true }
  }

  async markStopDelivered(
    tenantId: string,
    routeId: string,
    stopId: string,
    pod?: Record<string, unknown>,
  ) {
    await this.get(tenantId, routeId)
    const stop = await this.prisma.routeStop.findFirst({ where: { id: stopId, routeId } })
    if (!stop) throw new NotFoundException('Stop not found')
    if (pod && Object.keys(pod).length > 0) {
      logger.info({ routeId, stopId, pod }, 'POD captured (logged; extend schema to persist)')
    }
    await this.prisma.routeStop.update({
      where: { id: stopId },
      data: { status: StopStatus.DELIVERED },
    })
    const stops = await this.prisma.routeStop.findMany({ where: { routeId } })
    const allDelivered = stops.every((s) => s.status === StopStatus.DELIVERED)
    if (allDelivered) {
      await this.prisma.deliveryRoute.update({
        where: { id: routeId },
        data: { status: RouteStatus.COMPLETED },
      })
    }
    return this.get(tenantId, routeId)
  }

  async markStopFailed(tenantId: string, routeId: string, stopId: string, reason?: string) {
    await this.get(tenantId, routeId)
    const stop = await this.prisma.routeStop.findFirst({ where: { id: stopId, routeId } })
    if (!stop) throw new NotFoundException('Stop not found')
    if (reason) logger.warn({ routeId, stopId, reason }, 'stop marked failed')

    await this.prisma.routeStop.update({
      where: { id: stopId },
      data: { status: StopStatus.FAILED },
    })
    return this.get(tenantId, routeId)
  }
}
