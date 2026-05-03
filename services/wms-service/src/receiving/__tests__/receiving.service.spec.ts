import { BadRequestException, NotFoundException } from '@nestjs/common'
import { of, throwError } from 'rxjs'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { ReceivingService } from '../receiving.service'
import type { PrismaService } from '../../prisma/prisma.service'
import type { HttpService } from '@nestjs/axios'
import type { ConfigService } from '@nestjs/config'

function makeReceivingService(mocks: {
  prisma: object
  httpGet?: jest.Mock
  httpPost?: jest.Mock
  publish?: jest.Mock
  config?: Record<string, string | undefined>
}) {
  const publish = mocks.publish ?? jest.fn().mockResolvedValue(undefined)
  const bus = { publish } as unknown as EventBusClient
  const prisma = mocks.prisma as unknown as PrismaService
  const httpGet = mocks.httpGet ?? jest.fn()
  const httpPost = mocks.httpPost ?? jest.fn()
  const http = {
    get: httpGet,
    post: httpPost,
  } as unknown as HttpService
  const config = {
    get: (k: string) => mocks.config?.[k] ?? 'http://localhost',
  } as unknown as ConfigService
  return { svc: new ReceivingService(prisma, bus, http, config), publish, httpGet, httpPost }
}

describe('ReceivingService', () => {
  const tenantId = 't1'
  const sessionId = 'sess1'

  it('completeSession rejects when no items', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: sessionId,
      tenantId,
      status: 'IN_PROGRESS',
      warehouseId: 'wh1',
      poId: null,
      items: [],
    })
    const { svc } = makeReceivingService({
      prisma: { receivingSession: { findFirst } },
    })
    await expect(svc.completeSession(sessionId, tenantId)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('scanItem rejects when session missing', async () => {
    const findFirst = jest.fn().mockResolvedValue(null)
    const { svc } = makeReceivingService({
      prisma: { receivingSession: { findFirst } },
    })
    await expect(
      svc.scanItem(sessionId, tenantId, 'u1', {
        barcode: 'X',
        receivedQty: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('scanItem rejects when SKU lookup fails', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: sessionId,
      tenantId,
      status: 'OPEN',
      poId: null,
    })
    const httpGet = jest.fn().mockReturnValue(throwError(() => new Error('network')))
    const { svc } = makeReceivingService({
      prisma: {
        receivingSession: { findFirst },
        receivingItem: { findFirst: jest.fn(), create: jest.fn() },
      },
      httpGet,
      config: { INTERNAL_SERVICE_SECRET: 'sec', INVENTORY_SERVICE_URL: 'http://inv' },
    })
    await expect(
      svc.scanItem(sessionId, tenantId, 'u1', { barcode: 'missing', receivedQty: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('completeSession publishes RECEIVING_COMPLETED and marks COMPLETED when no damage', async () => {
    const items = [
      {
        id: 'i1',
        skuId: 'sku1',
        purchaseOrderLineId: null,
        receivedQty: 3,
        damagedQty: 0,
        batchId: null,
        locationId: null,
      },
    ]
    const findFirst = jest.fn().mockResolvedValue({
      id: sessionId,
      tenantId,
      status: 'IN_PROGRESS',
      warehouseId: 'wh1',
      poId: null,
      items,
    })
    const update = jest.fn().mockResolvedValue({})
    const httpPost = jest.fn().mockReturnValue(of({ data: {} }))
    const httpGet = jest.fn()
    const { svc, publish } = makeReceivingService({
      prisma: {
        receivingSession: { findFirst, update },
      },
      httpGet,
      httpPost,
      config: {
        INTERNAL_SERVICE_SECRET: 'sec',
        INVENTORY_SERVICE_URL: 'http://inv',
        PURCHASING_SERVICE_URL: 'http://pur',
      },
    })

    const result = await svc.completeSession(sessionId, tenantId)
    expect(result.status).toBe('COMPLETED')
    expect(httpPost).toHaveBeenCalledWith(
      expect.stringContaining('/inventory/receive'),
      expect.objectContaining({
        skuId: 'sku1',
        quantity: 3,
        warehouseId: 'wh1',
      }),
      expect.any(Object),
    )
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EventType.RECEIVING_COMPLETED,
        payload: expect.objectContaining({
          hasDiscrepancy: false,
        }),
      }),
    )
  })

  it('completeSession marks DISCREPANCY when damaged qty present', async () => {
    const items = [
      {
        id: 'i1',
        skuId: 'sku1',
        purchaseOrderLineId: null,
        receivedQty: 3,
        damagedQty: 1,
        batchId: null,
        locationId: null,
      },
    ]
    const findFirst = jest.fn().mockResolvedValue({
      id: sessionId,
      tenantId,
      status: 'IN_PROGRESS',
      warehouseId: 'wh1',
      poId: null,
      items,
    })
    const update = jest.fn().mockResolvedValue({})
    const httpPost = jest.fn().mockReturnValue(of({ data: {} }))
    const { svc, publish } = makeReceivingService({
      prisma: { receivingSession: { findFirst, update } },
      httpPost,
      config: {
        INTERNAL_SERVICE_SECRET: 'sec',
        INVENTORY_SERVICE_URL: 'http://inv',
        PURCHASING_SERVICE_URL: 'http://pur',
      },
    })

    const result = await svc.completeSession(sessionId, tenantId)
    expect(result.status).toBe('DISCREPANCY')
    expect(httpPost).toHaveBeenCalledWith(
      expect.stringContaining('/inventory/receive'),
      expect.objectContaining({ quantity: 2 }),
      expect.any(Object),
    )
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ hasDiscrepancy: true }),
      }),
    )
  })
})
