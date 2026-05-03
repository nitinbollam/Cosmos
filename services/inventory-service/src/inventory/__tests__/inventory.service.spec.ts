import { Test } from '@nestjs/testing'
import { InventoryService } from '../inventory.service'
import { PrismaService } from '../../prisma/prisma.service'
import { EventBusClient } from '@cosmos/event-bus'

describe('InventoryService.reserveStock', () => {
  let svc: InventoryService
  let prisma: any
  let bus: any

  beforeEach(async () => {
    prisma = {
      stockLevel: { findFirst: jest.fn(), update: jest.fn() },
      stockReservation: { create: jest.fn() },
      $transaction: jest.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
    }
    bus = { publish: jest.fn().mockResolvedValue(undefined) }

    const mod = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventBusClient, useValue: bus },
      ],
    }).compile()

    svc = mod.get(InventoryService)
  })

  it('rejects reservation when insufficient available', async () => {
    prisma.stockLevel.findFirst.mockResolvedValue({ id: 'lvl', quantityAvailable: 2 })
    await expect(
      svc.reserveStock('t1', { skuId: 's1', warehouseId: 'w1', quantity: 5, orderId: 'o1', correlationId: 'c1' }),
    ).rejects.toThrow(/Insufficient stock/)
    expect(bus.publish).not.toHaveBeenCalled()
  })

  it('creates reservation when sufficient', async () => {
    prisma.stockLevel.findFirst.mockResolvedValue({ id: 'lvl', quantityAvailable: 10 })
    const id = await svc.reserveStock('t1', {
      skuId: 's1', warehouseId: 'w1', quantity: 3, orderId: 'o1', correlationId: 'c1',
    })
    expect(typeof id).toBe('string')
    expect(bus.publish).toHaveBeenCalledTimes(1)
  })
})
