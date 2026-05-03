import type { DLQAlertConfig } from './dlq-monitor'

/**
 * When **`EventBusClient.subscribe`** is used, pass **`{ dlq: pagerDutyDlqFromEnv(process.env.SERVICE_NAME) }`**
 * to fire **[PagerDuty Events v2](https://developer.pagerduty.com/docs/ZG9jOjExMDI5NTgw-send-an-event-events-api-v2)** alerts after BullMQ retries are exhausted.
 * Set **`PAGERDUTY_ROUTING_KEY`** in the environment (see root `.env.example`).
 */
export function pagerDutyDlqFromEnv(preferredServiceName?: string): DLQAlertConfig | undefined {
  const pdRoutingKey =
    process.env.PAGERDUTY_ROUTING_KEY?.trim() || process.env.PAGERDUTY_EVENTS_ROUTING_KEY?.trim()
  if (!pdRoutingKey) return undefined
  const serviceName = (
    preferredServiceName ??
    process.env.SERVICE_NAME ??
    process.env.npm_package_name ??
    'cosmos-service'
  ).trim()
  return {
    pdRoutingKey,
    serviceName,
    environment: process.env.NODE_ENV ?? 'development',
  }
}
