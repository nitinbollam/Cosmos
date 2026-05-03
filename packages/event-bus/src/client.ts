import { Queue, Worker, Job, JobsOptions } from 'bullmq'
import { Redis } from 'ioredis'
import { BaseEvent, EventType } from './events'
import { logger } from '@cosmos/logger'
import { attachWorkerDlqPagerDuty, type DLQAlertConfig } from './dlq-monitor'

export interface EventBusClientOptions {
  redisUrl: string
  serviceName: string
}

export interface SubscribeOptions {
  concurrency?: number
  jobOptions?: JobsOptions
  dlq?: DLQAlertConfig
}

export class EventBusClient {
  private connection: Redis
  private queues: Map<string, Queue> = new Map()
  private workers: Worker[] = []

  constructor(private options: EventBusClientOptions) {
    this.connection = new Redis(options.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })

    this.connection.on('error', (err) => {
      logger.error({ err: err.message, service: options.serviceName }, 'event-bus redis error')
    })
  }

  private getQueue(eventType: EventType): Queue {
    let q = this.queues.get(eventType)
    if (!q) {
      q = new Queue(eventType, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      })
      this.queues.set(eventType, q)
    }
    return q
  }

  async publish<T>(event: BaseEvent<T>): Promise<void> {
    const queue = this.getQueue(event.type)
    await queue.add(event.type, event, { jobId: event.id })
    logger.info(
      { eventType: event.type, eventId: event.id, tenantId: event.tenantId, correlationId: event.correlationId },
      'event published',
    )
  }

  subscribe<T>(
    eventType: EventType,
    handler: (event: BaseEvent<T>, job: Job) => Promise<void>,
    opts: SubscribeOptions = {},
  ): Worker {
    const worker = new Worker(
      eventType,
      async (job: Job) => {
        const event = job.data as BaseEvent<T>
        try {
          await handler(event, job)
        } catch (error) {
          logger.error(
            {
              err: (error as Error).message,
              stack: (error as Error).stack,
              eventType,
              eventId: event.id,
              attemptsMade: job.attemptsMade,
            },
            'event handler failed',
          )
          throw error
        }
      },
      {
        connection: this.connection,
        concurrency: opts.concurrency ?? 5,
      },
    )

    worker.on('failed', (job, err) => {
      const isLastAttempt = (job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 1)
      logger.error(
        {
          jobId: job?.id,
          eventType,
          err: err.message,
          attemptsMade: job?.attemptsMade,
          movedToDLQ: isLastAttempt,
        },
        isLastAttempt ? 'job moved to DLQ' : 'job failed; will retry',
      )
    })

    worker.on('completed', (job) => {
      logger.debug({ jobId: job.id, eventType }, 'event handled')
    })

    if (opts.dlq) {
      attachWorkerDlqPagerDuty(worker, String(eventType), opts.dlq)
    }

    this.workers.push(worker)
    return worker
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()))
    await Promise.all([...this.queues.values()].map((q) => q.close()))
    await this.connection.quit()
  }
}

export function createEvent<T>(
  type: EventType,
  payload: T,
  ctx: { tenantId: string; correlationId: string; causationId?: string; metadata?: Record<string, unknown> },
): BaseEvent<T> {
  return {
    id: crypto.randomUUID(),
    type,
    tenantId: ctx.tenantId,
    timestamp: new Date(),
    correlationId: ctx.correlationId,
    causationId: ctx.causationId,
    version: 1,
    payload,
    metadata: ctx.metadata,
  }
}
