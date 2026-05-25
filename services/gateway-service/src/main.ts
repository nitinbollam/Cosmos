import './tracing-bootstrap'
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express'
import { AppModule } from './app.module'
import { ProxyService } from './proxy/proxy.service'
import { parseProxyParts } from './proxy/parseProxyParts'
import { mountPrometheusMetrics } from '@cosmos/metrics'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true, bodyParser: true })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
  app.setGlobalPrefix('api/v1')

  const proxyService = app.get(ProxyService)
  const logger = new Logger('gateway-proxy')

  const server = app.getHttpAdapter().getInstance()
  mountPrometheusMetrics(server, 'gateway-service')

  // Parse JSON on the raw Express stack before the proxy reads req.body.
  server.use(json({ limit: '2mb' }))
  server.use(urlencoded({ extended: true }))

  server.use(async (req: Request, res: Response, next: NextFunction) => {
    const parsed = parseProxyParts(req.originalUrl ?? '')
    if (!parsed) return next()
    try {
      await proxyService.forwardRequest(parsed.service, parsed.restPath, req, res)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message || err.name
          : typeof err === 'string'
            ? err
            : 'proxy error'
      logger.warn(message)
      if (!res.headersSent) {
        const status = typeof (err as { status?: number })?.status === 'number' ? (err as any).status : 502
        res.status(status).json({ message: message || 'Bad gateway' })
      }
    }
  })

  const port = parseInt(process.env.PORT ?? '3000', 10)
  await app.listen(port)
  new Logger('gateway-service').log('gateway-service listening on :' + port)
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('gateway-service failed to start', err)
  process.exit(1)
})
