import { Injectable, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { createHmac } from 'crypto'

export interface WebhookSubscription {
  id: string
  tenantId: string
  event: string
  url: string
  description?: string
  active: boolean
  createdAt: string
}

@Injectable()
export class WebhookStoreService implements OnModuleInit {
  private redis!: Redis

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.redis = new Redis(this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379', {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    })
  }

  private key(tenantId: string) {
    return `cosmos:webhooks:${tenantId}`
  }

  async upsert(sub: WebhookSubscription): Promise<void> {
    await this.redis.hset(this.key(sub.tenantId), sub.id, JSON.stringify(sub))
  }

  async list(tenantId: string): Promise<WebhookSubscription[]> {
    const raw = await this.redis.hgetall(this.key(tenantId))
    return Object.values(raw).map((v) => JSON.parse(v) as WebhookSubscription)
  }

  async get(tenantId: string, id: string): Promise<WebhookSubscription | null> {
    const raw = await this.redis.hget(this.key(tenantId), id)
    return raw ? (JSON.parse(raw) as WebhookSubscription) : null
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.redis.hdel(this.key(tenantId), id)
  }

  async getForEvent(tenantId: string, event: string): Promise<WebhookSubscription[]> {
    const all = await this.list(tenantId)
    return all.filter((s) => s.active && (s.event === '*' || s.event === event))
  }

  sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex')
  }
}
