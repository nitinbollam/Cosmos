import { runOrderFulfillmentPipeline } from './order-orchestration'

/** Reserve inventory, create fulfillment task, and confirm order → PROCESSING. */
export async function runOrderSaga(orderId: string, tenantId: string, correlationId: string): Promise<void> {
  await runOrderFulfillmentPipeline(orderId, tenantId, correlationId).catch(() => undefined)
}
