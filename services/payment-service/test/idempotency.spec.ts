import { Test } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { COSMOS_IDEMPOTENCY_REDIS } from '@cosmos/idempotency'
import { EventBusClient } from '@cosmos/event-bus'
import Redis from 'ioredis-mock'
import { Decimal } from '../src/generated/prisma-client/runtime/library'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

function mockPrismaForCashAuthorize() {
  return {
    paymentIntent: {
      create: jest.fn().mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => {
          const id = `pi-${String(data.correlationId)}`
          return {
            id,
            tenantId: data.tenantId,
            orderId: data.orderId,
            amount: data.amount,
            currency: data.currency,
            paymentMethod: data.paymentMethod,
            customerId: data.customerId,
            correlationId: data.correlationId,
            status: 'PENDING',
            stripeIntentId: null,
            capturedAmount: null,
            refundedAmount: new Decimal(0),
            failureReason: null,
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        },
      ),
      update: jest.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: where.id,
        tenantId: 'tenant-idem-test',
        orderId: 'order-x',
        amount: new Decimal(1000),
        currency: 'USD',
        paymentMethod: 'CASH',
        customerId: 'cus_test',
        correlationId: 'corr-x',
        status: data.status,
        stripeIntentId: data.stripeIntentId ?? null,
        capturedAmount: data.capturedAmount ?? null,
        refundedAmount: new Decimal(0),
        failureReason: data.failureReason ?? null,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
  } as unknown as PrismaService
}

describe('Payment Idempotency', () => {
  let app: INestApplication

  beforeAll(async () => {
    const prisma = mockPrismaForCashAuthorize()

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(COSMOS_IDEMPOTENCY_REDIS)
      .useFactory({ factory: () => new Redis() })
      .overrideProvider(EventBusClient)
      .useValue({ publish: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile()

    app = moduleRef.createNestApplication({ rawBody: true })
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    )
    app.setGlobalPrefix('api/v1')
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  const internalHeaders = () => ({
    'x-cosmos-internal-key': process.env.INTERNAL_SERVICE_SECRET!,
    'x-cosmos-tenant-id': 'tenant-idem-test',
  })

  it('returns identical response on duplicate Idempotency-Key', async () => {
    const key = `test-idem-${Date.now()}`
    const payload = {
      orderId: `order-${key}`,
      amount: 1000,
      currency: 'USD',
      paymentMethod: 'CASH',
      customerId: 'cus_test',
      correlationId: `corr-${key}`,
    }

    const r1 = await request(app.getHttpServer())
      .post('/api/v1/payments/authorize')
      .set('Idempotency-Key', key)
      .set(internalHeaders())
      .send(payload)

    const r2 = await request(app.getHttpServer())
      .post('/api/v1/payments/authorize')
      .set('Idempotency-Key', key)
      .set(internalHeaders())
      .send(payload)

    expect(r1.status).toBe(r2.status)
    expect(r1.body).toEqual(r2.body)
  })

  it('rejects mutation without Idempotency-Key', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/v1/payments/authorize')
      .set(internalHeaders())
      .send({
        orderId: 'o1',
        amount: 1000,
        currency: 'USD',
        paymentMethod: 'CASH',
        customerId: 'cus_test',
        correlationId: 'c1',
      })
    expect(r.status).toBe(400)
  })
})
