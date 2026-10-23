import { runOrderFulfillmentPipeline, type PipelineOutcome } from './order-orchestration'

/**
 * Reserve inventory, create fulfillment task, and confirm order → PROCESSING.
 * Returns the outcome; a failed run is logged by the pipeline (with order and correlation ids) and rethrown.
 */
export async function runOrderSaga(orderId: string, tenantId: string, correlationId: string): Promise<PipelineOutcome> {
  return runOrderFulfillmentPipeline(orderId, tenantId, correlationId)
}
