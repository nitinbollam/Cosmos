import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import type { Request, Response } from 'express'

const SERVICE_ENV_KEYS: Record<string, string> = {
  auth: 'AUTH_SERVICE_URL',
  tenant: 'TENANT_SERVICE_URL',
  inventory: 'INVENTORY_SERVICE_URL',
  wms: 'WMS_SERVICE_URL',
  order: 'ORDER_SERVICE_URL',
  purchasing: 'PURCHASING_SERVICE_URL',
  compliance: 'COMPLIANCE_SERVICE_URL',
  storefront: 'STOREFRONT_SERVICE_URL',
  pos: 'POS_SERVICE_URL',
  crm: 'CRM_SERVICE_URL',
  dispatch: 'DISPATCH_SERVICE_URL',
  payment: 'PAYMENT_SERVICE_URL',
  ledger: 'LEDGER_SERVICE_URL',
  analytics: 'ANALYTICS_SERVICE_URL',
  notification: 'NOTIFICATION_SERVICE_URL',
}

const FORWARD_HEADERS = new Set([
  'authorization',
  'content-type',
  'accept',
  'accept-language',
  'x-cosmos-tenant-id',
  'x-cosmos-internal-key',
  'idempotency-key',
  'x-request-id',
  'x-correlation-id',
  'x-service-token',
])

@Injectable()
export class ProxyService {
  private readonly windowMs = 60_000
  private readonly maxRequests = 200
  private readonly hits = new Map<string, number[]>()

  constructor(private readonly http: HttpService) {}

  private throttle(clientKey: string) {
    const now = Date.now()
    const windowStart = now - this.windowMs
    const arr = (this.hits.get(clientKey) ?? []).filter((t) => t > windowStart)
    if (arr.length >= this.maxRequests) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS)
    }
    arr.push(now)
    this.hits.set(clientKey, arr)
  }

  resolveBase(serviceKey: string): string {
    const env = SERVICE_ENV_KEYS[serviceKey.toLowerCase()]
    if (!env) throw new NotFoundException(`Unknown proxy service: ${serviceKey}`)
    const base = process.env[env]?.trim().replace(/\/$/, '')
    if (!base) throw new NotFoundException(`Missing env ${env}`)
    return base
  }

  /**
   * `restPath` is the path after /api/v1/_proxy/:service/ (no leading slash).
   */
  async forwardRequest(serviceKey: string, restPath: string, req: Request, res: Response) {
    const clientKey =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown'
    this.throttle(clientKey)

    const base = this.resolveBase(serviceKey)
    const targetPath = `${base}/api/v1/${restPath.replace(/^\//, '')}`

    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (!v) continue
      const low = k.toLowerCase()
      if (!FORWARD_HEADERS.has(low)) continue
      headers[k] = Array.isArray(v) ? v.join(',') : v
    }

    const method = req.method.toUpperCase()
    const hasBody = !['GET', 'HEAD'].includes(method)

    const upstream = await firstValueFrom(
      this.http.request({
        method,
        url: targetPath,
        params: req.query as Record<string, string>,
        headers,
        data: hasBody ? req.body : undefined,
        responseType: 'stream',
        validateStatus: () => true,
        maxRedirects: 0,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }),
    )

    res.status(upstream.status)
    for (const [k, v] of Object.entries(upstream.headers)) {
      if (v === undefined) continue
      const low = k.toLowerCase()
      if (['transfer-encoding', 'connection'].includes(low)) continue
      res.setHeader(k, v as string | string[])
    }

    const stream = upstream.data as NodeJS.ReadableStream
    stream.pipe(res)
  }
}
