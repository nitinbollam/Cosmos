import * as client from 'prom-client'
import { createMetricsRegistry, metricsMiddleware, mountPrometheusMetrics } from './index'

describe('@cosmos/metrics', () => {
  it('createMetricsRegistry sets service_name label and default metrics', async () => {
    const reg = createMetricsRegistry('unit-test')
    expect(reg).toBeInstanceOf(client.Registry)
    const text = await reg.metrics()
    expect(text).toContain('process_cpu_user_seconds_total')
    expect(text).toContain('service_name="unit-test"')
  })

  it('metricsMiddleware responds with 200 and prometheus content-type', async () => {
    const reg = createMetricsRegistry('mw-test')
    const handler = metricsMiddleware(reg)
    const headers: Record<string, string | undefined> = {}
    let status = 0
    let body = ''
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v
      },
      status: (n: number) => {
        status = n
        return res
      },
      send: (x: string) => {
        body = x
        return res
      },
    }
    await handler({} as never, res as never)
    expect(status).toBe(200)
    expect(headers['Content-Type']).toBeDefined()
    expect(String(headers['Content-Type'])).toContain('text/plain')
    expect(body).toContain('process_cpu_user_seconds_total')
  })

  it('mountPrometheusMetrics registers GET /metrics', () => {
    const routes: { path: string; handler: unknown }[] = []
    const fakeApp = {
      get: (path: string, handler: unknown) => {
        routes.push({ path, handler })
      },
    }
    mountPrometheusMetrics(fakeApp as never, 'fake-svc')
    expect(routes.some((r) => r.path === '/metrics')).toBe(true)
  })
})
