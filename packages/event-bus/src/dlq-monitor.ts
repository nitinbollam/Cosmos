import type { Job, Worker } from 'bullmq'
import { logger } from '@cosmos/logger'

export interface DLQAlertConfig {
  pdRoutingKey: string
  serviceName: string
  environment: string
}

async function sendPagerDutyAlert(
  config: DLQAlertConfig,
  details: {
    summary: string
    severity: string
    component: string
    group: string
    customDetails: Record<string, unknown>
  },
): Promise<void> {
  try {
    const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing_key: config.pdRoutingKey,
        event_action: 'trigger',
        payload: {
          summary: details.summary,
          severity: details.severity,
          source: config.serviceName,
          component: details.component,
          group: details.group,
          custom_details: details.customDetails,
          timestamp: new Date().toISOString(),
        },
      }),
    })

    if (!response.ok) {
      logger.error({ status: response.status }, 'PagerDuty enqueue rejected')
    }
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'PagerDuty alert transport failed')
  }
}

/** Attach after worker creation — alerts when retries are exhausted (permanent failure). */
export function attachWorkerDlqPagerDuty(
  worker: Worker,
  queueName: string,
  config: DLQAlertConfig,
): Worker {
  worker.on('failed', (job: Job | undefined, err: Error) => {
    if (!job) return

    const maxAttempts = job.opts.attempts ?? 1
    const exhausted = (job.attemptsMade ?? 0) >= maxAttempts
    if (!exhausted) return

    logger.error(
      {
        queueName,
        jobId: job.id,
        attemptsMade: job.attemptsMade,
        error: err.message,
      },
      'event-bus job exhausted retries — triggering PagerDuty',
    )

    void sendPagerDutyAlert(config, {
      severity: 'critical',
      summary: `[${config.serviceName}] BullMQ job permanently failed: ${queueName}`,
      component: queueName,
      group: 'event-bus-dlq',
      customDetails: {
        jobId: job.id,
        queue: queueName,
        attemptsMade: job.attemptsMade,
        error: err.message,
        payloadPreview: JSON.stringify(job.data).substring(0, 500),
        environment: config.environment,
      },
    })
  })

  return worker
}
