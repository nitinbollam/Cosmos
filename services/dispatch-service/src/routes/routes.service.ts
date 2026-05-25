import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, RouteStatus, StopStatus } from '../generated/prisma-client'
import { PrismaService } from '../prisma/prisma.service'
import { AssignDriverDto } from './dto/assign-driver.dto'
import { CreateRouteDto } from './dto/create-route.dto'
import { logger } from '@cosmos/logger'

@Injectable()
export class RoutesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, date?: string) {
    const where: Prisma.DeliveryRouteWhereInput = { tenantId }
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const start = new Date(`${date}T00:00:00.000Z`)
      const end = new Date(`${date}T23:59:59.999Z`)
      where.OR = [
        { scheduledFor: { gte: start, lte: end } },
        { AND: [{ scheduledFor: null }, { createdAt: { gte: start, lte: end } }] },
      ]
    }
    return this.prisma.deliveryRoute.findMany({
      where,
      include: { stops: { orderBy: { sequence: 'asc' } } },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
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
    let scheduledFor: Date | undefined
    if (dto.scheduledFor?.trim()) {
      const d = new Date(dto.scheduledFor)
      if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid scheduledFor')
      scheduledFor = d
    }
    return this.prisma.deliveryRoute.create({
      data: {
        tenantId,
        name: dto.name,
        scheduledFor,
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

  /** Mobile / telemetry — persist last-known GPS on the route for admin live map. */
  async recordDriverLocation(
    tenantId: string,
    userId: string,
    body: { lat: number; lng: number; timestamp?: string; routeId?: string },
  ): Promise<{ ok: boolean }> {
    const ts = body.timestamp ? new Date(body.timestamp) : new Date()
    const rid = body.routeId?.trim()
    if (rid) {
      const route = await this.prisma.deliveryRoute.findFirst({ where: { id: rid, tenantId } })
      if (!route) throw new NotFoundException('Route not found')
      if (!route.driverId || route.driverId !== userId) {
        throw new ForbiddenException('Location allowed only for the assigned driver')
      }
      await this.prisma.deliveryRoute.update({
        where: { id: rid },
        data: {
          lastKnownLat: body.lat,
          lastKnownLng: body.lng,
          lastKnownAt: ts,
        },
      })
    }
    logger.info(
      { tenantId, userId, lat: body.lat, lng: body.lng, at: ts.toISOString(), routeId: rid ?? null },
      'driver location',
    )
    return { ok: true }
  }

  async reorderStops(tenantId: string, routeId: string, stopIds: string[]) {
    await this.get(tenantId, routeId)
    const stops = await this.prisma.routeStop.findMany({ where: { routeId } })
    if (stopIds.length !== stops.length) {
      throw new BadRequestException('Must include every stop id for this route')
    }
    const expected = new Set(stops.map((s) => s.id))
    for (const id of stopIds) {
      if (!expected.has(id)) throw new BadRequestException('Unknown stop id for this route')
    }
    await this.prisma.$transaction(
      stopIds.map((id, i) =>
        this.prisma.routeStop.update({
          where: { id },
          data: { sequence: i + 1 },
        }),
      ),
    )
    return this.get(tenantId, routeId)
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
