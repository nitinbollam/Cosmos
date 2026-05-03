import type { Request, Response } from 'express'
import * as client from 'prom-client'

/** Prometheus registry with default process metrics and a static service label. */
export function createMetricsRegistry(serviceName: string): client.Registry {
  const registry = new client.Registry()
  registry.setDefaultLabels({ service_name: serviceName })
  client.collectDefaultMetrics({ register: registry })
  return registry
}

/** Express middleware mounting GET /metrics (call after global prefix if metrics must be at root). */
export function metricsMiddleware(registry: client.Registry) {
  return async (_req: Request, res: Response): Promise<void> => {
    res.setHeader('Content-Type', registry.contentType)
    res.status(200).send(await registry.metrics())
  }
}
