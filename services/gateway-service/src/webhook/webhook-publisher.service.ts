import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { WebhookStoreService } from './webhook-store.service'
import Redis from 'ioredis'
import { randomUUID } from 'crypto'

const COSMOS_EVENTS = [
  'order.created',
  'order.confirmed',
  'order.cancelled',
  'order.fulfilled',
  'order.shipped',
  'order.delivered',
  'order.returned',
  'inventory.stock_received',
  'inventory.stock_adjusted',
  'inventory.stock_level_low',
  'inventory.stock_depleted',
  'wms.receiving_completed',
  'wms.shipment_dispatched',
  'wms.pick_list_completed',
  'finance.payment_captured',
  'finance.payment_failed',
  'finance.payment_refunded',
  'finance.invoice_generated',
  'purchasing.po_created',
  'purchasing.po_approved',
  'purchasing.po_received',
  'crm.customer_created',
  'crm.lead_converted',
  'dispatch.delivery_completed',
  'dispatch.driver_assigned',
  'compliance.batch_recalled',
  'compliance.batch_expiry_alert',
]

@Injectable()
export class WebhookPublisherService implements OnModuleInit {
  private readonly logger = new Logger(WebhookPublisherService.name)
  private subscriber!: Redis
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly signingSecret: string

  constructor(
    private config: ConfigService,
    private store: WebhookStoreService,
  ) {
    this.timeoutMs = Number(this.config.get('WEBHOOK_DEFAULT_TIMEOUT_MS') ?? 10000)
    this.maxRetries = Number(this.config.get('WEBHOOK_MAX_RETRIES') ?? 3)
    this.signingSecret = this.config.get<string>('WEBHOOK_SIGNING_SECRET') ?? 'dev-secret'
  }

  onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379'
    this.subscriber = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 })

    void this.subscriber.psubscribe('cosmos:events:*', (err) => {
      if (err) this.logger.error('Failed to subscribe to cosmos events', err)
      else this.logger.log('WebhookPublisher subscribed to cosmos:events:*')
    })

    this.subscriber.on('pmessage', (_pattern, _channel, message) => {
      void this.handleEvent(message)
    })
  }

  private async handleEvent(message: string): Promise<void> {
    let parsed: { type?: string; tenantId?: string; payload?: unknown; id?: string }
    try {
      parsed = JSON.parse(message)
    } catch {
      return
    }

    const { type, tenantId, payload, id } = parsed
    if (!type || !tenantId) return
    if (!COSMOS_EVENTS.includes(type)) return

    const subs = await this.store.getForEvent(tenantId, type)
    if (subs.length === 0) return

    const body = JSON.stringify({
      id: id ?? randomUUID(),
      event: type,
      tenantId,
      timestamp: new Date().toISOString(),
      data: payload ?? {},
    })

    const signature = this.store.sign(body, this.signingSecret)

    await Promise.allSettled(
      subs.map((sub) => this.deliverWithRetry(sub.url, body, signature, type, tenantId)),
    )
  }

  private async deliverWithRetry(
    url: string,
    body: string,
    signature: string,
    event: string,
    tenantId: string,
    attempt = 1,
  ): Promise<void> {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cosmos-Signature': `sha256=${signature}`,
          'X-Cosmos-Event': event,
          'X-Cosmos-Tenant': tenantId,
          'X-Cosmos-Attempt': String(attempt),
        },
        body,
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      this.logger.debug({ url, event, attempt }, 'webhook delivered')
    } catch (err) {
      this.logger.warn({ url, event, attempt, err: (err as Error).message }, 'webhook failed')
      if (attempt < this.maxRetries) {
        const delay = Math.pow(4, attempt - 1) * 1000
        await new Promise((r) => setTimeout(r, delay))
        return this.deliverWithRetry(url, body, signature, event, tenantId, attempt + 1)
      }
      this.logger.error({ url, event }, 'webhook exhausted retries')
    }
  }
}
