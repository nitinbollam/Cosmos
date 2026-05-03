import { Injectable } from '@nestjs/common'
import { EventBusClient, EventType } from '@cosmos/event-bus'
import { PrismaService } from '../prisma/prisma.service'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'
import { logger } from '@cosmos/logger'
import { firstValueFrom } from 'rxjs'
import type { OrderLineItem } from '../generated/prisma-client'

export enum SagaStep {
  RESERVE_INVENTORY = 'RESERVE_INVENTORY',
  AUTHORIZE_PAYMENT = 'AUTHORIZE_PAYMENT',
  CREATE_FULFILLMENT = 'CREATE_FULFILLMENT',
  RECORD_TAX = 'RECORD_TAX',
}

export enum SagaStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  COMPENSATING = 'COMPENSATING',
  FAILED = 'FAILED',
}

@Injectable()
export class OrderSaga {
  constructor(
    private prisma: PrismaService,
    private eventBus: EventBusClient,
    private http: HttpService,
    private config: ConfigService,
  ) {}

  /** Machine-to-machine auth for downstream microservices (see `InternalOrJwtAuthGuard`). */
  private internalHeaders(tenantId: string): Record<string, string> {
    const secret = this.config.get<string>('INTERNAL_SERVICE_SECRET') ?? ''
    return {
      'x-cosmos-internal-key': secret,
      'x-cosmos-tenant-id': tenantId,
    }
  }

  async execute(orderId: string, tenantId: string, correlationId: string): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { lineItems: true },
    })
    if (!order) throw new Error(`Order ${orderId} not found`)

    const lineItemsPayload = order.lineItems.map((li: OrderLineItem) => ({
      skuId: li.skuId,
      warehouseId: li.warehouseId,
      quantity: li.quantity,
      unitPrice: Number(li.unitPrice),
    }))

    const sagaId = randomUUID()
    await this.prisma.orderSaga.create({
      data: {
        id: sagaId,
        orderId,
        tenantId,
        status: SagaStatus.RUNNING,
        correlationId,
        completedSteps: [],
        compensations: {},
      },
    })

    const compensations: Record<string, () => Promise<void>> = {}

    try {
      const ih = this.internalHeaders(tenantId)

      // Step 1: reserve inventory
      const reservationIds: string[] = []
      for (const item of order.lineItems) {
        const response = await firstValueFrom(
          this.http.post(
            `${this.config.get('INVENTORY_SERVICE_URL')}/api/v1/inventory/stock/reserve`,
            {
              skuId: item.skuId,
              warehouseId: item.warehouseId,
              quantity: item.quantity,
              orderId,
              correlationId,
            },
            { headers: ih },
          ),
        )
        reservationIds.push((response.data as { reservationId: string }).reservationId)
      }
      compensations[SagaStep.RESERVE_INVENTORY] = async () => {
        for (const rid of reservationIds) {
          await firstValueFrom(
            this.http.post(
              `${this.config.get('INVENTORY_SERVICE_URL')}/api/v1/inventory/stock/release`,
              { reservationId: rid, correlationId },
              { headers: ih },
            ),
          ).catch((e) => logger.error({ err: (e as Error).message }, 'compensation: release failed'))
        }
      }
      await this.markStepComplete(sagaId, SagaStep.RESERVE_INVENTORY)

      // Step 2: authorize payment
      let paymentIntentId: string | undefined
      if (order.paymentMethod !== 'NET_TERMS') {
        const paymentResp = await firstValueFrom(
          this.http.post(
            `${this.config.get('PAYMENT_SERVICE_URL')}/api/v1/payments/authorize`,
            {
              orderId,
              amount: Number(order.totalAmount),
              currency: 'USD',
              paymentMethod: order.paymentMethod,
              customerId: order.customerId,
              correlationId,
            },
            { headers: { ...ih, 'Idempotency-Key': `payments-authorize-${correlationId}-${orderId}` } },
          ),
        )
        paymentIntentId = (paymentResp.data as { paymentIntentId?: string }).paymentIntentId
        compensations[SagaStep.AUTHORIZE_PAYMENT] = async () => {
          if (paymentIntentId) {
            await firstValueFrom(
              this.http.post(
                `${this.config.get('PAYMENT_SERVICE_URL')}/api/v1/payments/void`,
                { paymentIntentId, correlationId },
                {
                  headers: {
                    ...ih,
                    'Idempotency-Key': `payments-void-${correlationId}-${paymentIntentId}`,
                  },
                },
              ),
            ).catch((e) => logger.error({ err: (e as Error).message }, 'compensation: void failed'))
          }
        }
      }
      await this.markStepComplete(sagaId, SagaStep.AUTHORIZE_PAYMENT)

      // Step 3: WMS fulfillment
      await firstValueFrom(
        this.http.post(
          `${this.config.get('WMS_SERVICE_URL')}/api/v1/fulfillment/tasks`,
          {
            orderId,
            lineItems: lineItemsPayload,
            priority: order.priority,
            correlationId,
          },
          { headers: ih },
        ),
      )
      compensations[SagaStep.CREATE_FULFILLMENT] = async () => {
        await firstValueFrom(
          this.http.delete(
            `${this.config.get('WMS_SERVICE_URL')}/api/v1/fulfillment/tasks/${orderId}`,
            { data: { correlationId }, headers: ih },
          ),
        ).catch((e) => logger.error({ err: (e as Error).message }, 'compensation: cancel fulfillment failed'))
      }
      await this.markStepComplete(sagaId, SagaStep.CREATE_FULFILLMENT)

      // Step 4: record tax liability
      await firstValueFrom(
        this.http.post(
          `${this.config.get('COMPLIANCE_SERVICE_URL')}/api/v1/tax/record`,
          {
            orderId,
            lineItems: lineItemsPayload,
            customerId: order.customerId,
            correlationId,
          },
          { headers: ih },
        ),
      )
      await this.markStepComplete(sagaId, SagaStep.RECORD_TAX)

      // confirm order
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), paymentIntentId },
      })
      await this.prisma.orderSaga.update({
        where: { id: sagaId },
        data: { status: SagaStatus.COMPLETED },
      })

      await this.eventBus.publish({
        id: randomUUID(),
        type: EventType.ORDER_CONFIRMED,
        tenantId,
        timestamp: new Date(),
        correlationId,
        version: 1,
        payload: { orderId, paymentIntentId },
      })

      logger.info({ orderId, sagaId }, 'order saga completed')
    } catch (error) {
      const msg = (error as Error).message
      logger.error({ orderId, sagaId, err: msg }, 'saga failed — compensating')

      await this.prisma.orderSaga.update({
        where: { id: sagaId },
        data: { status: SagaStatus.COMPENSATING },
      })

      for (const step of Object.keys(compensations).reverse()) {
        try {
          await compensations[step]()
        } catch (ce) {
          logger.error({ step, err: (ce as Error).message }, 'compensation step failed')
        }
      }

      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'FAILED', failureReason: msg },
      })
      await this.prisma.orderSaga.update({
        where: { id: sagaId },
        data: { status: SagaStatus.FAILED, failureReason: msg },
      })

      await this.eventBus.publish({
        id: randomUUID(),
        type: EventType.ORDER_CANCELLED,
        tenantId,
        timestamp: new Date(),
        correlationId,
        version: 1,
        payload: { orderId, reason: msg },
      })

      throw error
    }
  }

  private async markStepComplete(sagaId: string, step: SagaStep) {
    await this.prisma.orderSaga.update({
      where: { id: sagaId },
      data: { completedSteps: { push: step } },
    })
  }
}
