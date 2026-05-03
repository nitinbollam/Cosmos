import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { FulfillmentService } from './fulfillment.service'
import type { PrismaService } from '../prisma/prisma.service'

function makeService(mocks: {
  prisma?: Record<string, unknown>
  publish?: jest.Mock
}) {
  const publish = mocks.publish ?? jest.fn().mockResolvedValue(undefined)
  const bus = { publish } as unknown as EventBusClient
  const prisma = mocks.prisma as unknown as PrismaService
  return { svc: new FulfillmentService(prisma, bus), publish }
}

describe('FulfillmentService', () => {
  it('createTask throws when active fulfillment exists', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 't1',
      status: 'PENDING',
    })
    const { svc } = makeService({
      prisma: {
        fulfillmentTask: { findUnique, create: jest.fn() },
        pickLine: { deleteMany: jest.fn() },
      },
    })
    await expect(
      svc.createTask('tenant-1', {
        orderId: 'o1',
        correlationId: 'c1',
        lineItems: [
          {
            skuId: 'sku1',
            warehouseId: 'wh1',
            quantity: 1,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('markPacked rejects when lines still PENDING', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'task1',
      tenantId: 't1',
      orderId: 'o1',
      status: 'PICKING',
      correlationId: 'corr',
      pickLines: [
        {
          id: 'l1',
          status: 'PENDING',
          pickedQty: 0,
          quantity: 1,
        },
      ],
    })
    const { svc, publish } = makeService({
      prisma: { fulfillmentTask: { findFirst, update: jest.fn() } },
    })

    await expect(svc.markPacked('t1', 'task1')).rejects.toBeInstanceOf(BadRequestException)
    expect(publish).not.toHaveBeenCalled()
  })

  it('markPacked updates when all lines PICKED', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'task1',
      tenantId: 't1',
      orderId: 'o1',
      status: 'PICKING',
      correlationId: 'corr',
      pickLines: [
        { id: 'l1', status: 'PICKED', pickedQty: 1, quantity: 1 },
        { id: 'l2', status: 'SHORT', pickedQty: 0, quantity: 2 },
      ],
    })
    const update = jest.fn().mockResolvedValue({ id: 'task1', status: 'PACKED' })
    const { svc, publish } = makeService({
      prisma: { fulfillmentTask: { findFirst, update } },
    })

    await expect(svc.markPacked('t1', 'task1')).resolves.toEqual(
      expect.objectContaining({ status: 'PACKED', orderId: 'o1' }),
    )
    expect(update).toHaveBeenCalled()
    expect(publish.mock.calls.some((c) => c[0]?.type === EventType.SHIPMENT_PACKED)).toBe(true)
  })

  it('markDispatched requires PACKED', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'task1',
      tenantId: 't1',
      orderId: 'o1',
      status: 'PICKING',
      correlationId: 'corr',
      pickLines: [],
    })
    const { svc } = makeService({
      prisma: { fulfillmentTask: { findFirst, update: jest.fn() } },
    })

    await expect(svc.markDispatched('t1', 'task1')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('markDispatched publishes dispatch + completed', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'task1',
      tenantId: 't1',
      orderId: 'o1',
      status: 'PACKED',
      correlationId: 'corr',
      pickLines: [],
    })
    const update = jest.fn().mockResolvedValue({ id: 'task1', status: 'DISPATCHED' })
    const { svc, publish } = makeService({
      prisma: { fulfillmentTask: { findFirst, update } },
    })

    await svc.markDispatched('t1', 'task1')
    expect(publish.mock.calls.some((c) => c[0]?.type === EventType.SHIPMENT_DISPATCHED)).toBe(true)
    expect(publish.mock.calls.some((c) => c[0]?.type === EventType.PICK_LIST_COMPLETED)).toBe(true)
  })

  it('getTaskForFloor throws when missing', async () => {
    const { svc } = makeService({
      prisma: {
        fulfillmentTask: { findFirst: jest.fn().mockResolvedValue(null) },
      },
    })
    await expect(svc.getTaskForFloor('t1', 'x')).rejects.toBeInstanceOf(NotFoundException)
  })
})
