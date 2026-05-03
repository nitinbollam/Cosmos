import type { DLQAlertConfig } from './dlq-monitor'

/**
 * Build **DLQ monitor config** from the environment. Always safe to pass to **`EventBusClient.subscribe`**
 * as **`{ dlq: dlqMonitorFromEnv('my-service') }`** — exhausted jobs are logged at **error**; PagerDuty fires
 * only when **`PAGERDUTY_ROUTING_KEY`** or **`PAGERDUTY_EVENTS_ROUTING_KEY`** is set.
 */
export function dlqMonitorFromEnv(preferredServiceName?: string): DLQAlertConfig {
  const pdRoutingKey =
    process.env.PAGERDUTY_ROUTING_KEY?.trim() || process.env.PAGERDUTY_EVENTS_ROUTING_KEY?.trim() || undefined
  const serviceName = (
    preferredServiceName ??
    process.env.SERVICE_NAME ??
    process.env.npm_package_name ??
    'cosmos-service'
  ).trim()
  return {
    ...(pdRoutingKey ? { pdRoutingKey } : {}),
    serviceName,
    environment: process.env.NODE_ENV ?? 'development',
  }
}

/**
 * @deprecated Use **`dlqMonitorFromEnv`** — it always returns a config so **`subscribe`** can attach the DLQ
 * listener (log + optional PagerDuty). This alias kept for compatibility.
 */
export function pagerDutyDlqFromEnv(preferredServiceName?: string): DLQAlertConfig {
  return dlqMonitorFromEnv(preferredServiceName)
}
