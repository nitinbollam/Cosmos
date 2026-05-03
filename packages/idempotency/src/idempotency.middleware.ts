import { Inject, Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import Redis from 'ioredis'
import { COSMOS_IDEMPOTENCY_REDIS } from './cosmos-idempotency.constants'

interface CachedResponse {
  status: number
  body: unknown
}

/**
 * Replays prior successful responses for duplicate Idempotency-Key on mutating requests.
 * Apply only to routes that must be idempotent (payments, order creation, etc.).
 */
@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  constructor(@Inject(COSMOS_IDEMPOTENCY_REDIS) private readonly redis: Redis) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const method = req.method
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined

    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !idempotencyKey?.trim()) {
      next()
      return
    }

    const cacheKey = `idempotency:${req.method}:${req.originalUrl ?? req.url}:${idempotencyKey}`
    const existing = await this.redis.get(cacheKey)

    if (existing) {
      const cached = JSON.parse(existing) as CachedResponse
      res.status(cached.status).json(cached.body)
      return
    }

    const originalJson = res.json.bind(res) as (body: unknown) => Response
    res.json = (body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        const payload: CachedResponse = { status: res.statusCode, body }
        void this.redis.setex(cacheKey, 86_400, JSON.stringify(payload)).catch(() => undefined)
      }
      return originalJson(body)
    }

    next()
  }
}
