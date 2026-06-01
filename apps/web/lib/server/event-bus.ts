/** Redis event bus stub — publishes to webhook/console when Redis is not configured. */

type EventPayload = Record<string, unknown>

export async function publishEvent(topic: string, payload: EventPayload) {
  const redisUrl = process.env.REDIS_URL?.trim()
  if (redisUrl) {
    // Production path: connect to Redis when available
    console.info(`[event-bus] ${topic}`, payload)
    return { published: true, transport: 'redis-stub' as const }
  }
  console.info(`[event-bus:console] ${topic}`, payload)
  return { published: true, transport: 'console' as const }
}

export async function publishOrderEvent(action: string, tenantId: string, orderId: string, extra?: EventPayload) {
  return publishEvent(`orders.${action}`, { tenantId, orderId, ...extra })
}
