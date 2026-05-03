import { Inject, Injectable } from '@nestjs/common'
import { COSMOS_IDEMPOTENCY_REDIS } from '@cosmos/idempotency'

const TTL_SECONDS = 86_400 // 24 hours

type RedisLike = {
  get(key: string): Promise<string | null>
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>
}

@Injectable()
export class PaymentIdempotencyService {
  constructor(@Inject(COSMOS_IDEMPOTENCY_REDIS) private readonly redis: RedisLike) {}

  async get(key: string): Promise<{ status: number; body: unknown } | null> {
    const raw = await this.redis.get(`idempotency:pay:${key}`)
    return raw ? (JSON.parse(raw) as { status: number; body: unknown }) : null
  }

  async set(key: string, status: number, body: unknown): Promise<void> {
    await this.redis.setex(`idempotency:pay:${key}`, TTL_SECONDS, JSON.stringify({ status, body }))
  }
}
