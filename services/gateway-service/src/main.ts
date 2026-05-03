import './tracing-bootstrap'
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { AppModule } from './app.module'
import { ProxyService } from './proxy/proxy.service'
import { parseProxyParts } from './proxy/parseProxyParts'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true, bodyParser: true })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
  app.setGlobalPrefix('api/v1')

  const proxyService = app.get(ProxyService)
  const logger = new Logger('gateway-proxy')

  const server = app.getHttpAdapter().getInstance()
  server.use(async (req: Request, res: Response, next: NextFunction) => {
    const parsed = parseProxyParts(req.originalUrl ?? '')
    if (!parsed) return next()
    try {
      await proxyService.forwardRequest(parsed.service, parsed.restPath, req, res)
    } catch (err) {
      logger.warn(err instanceof Error ? err.message : String(err))
      if (!res.headersSent) {
        const status = typeof (err as { status?: number })?.status === 'number' ? (err as any).status : 502
        res.status(status).json({ message: err instanceof Error ? err.message : 'proxy error' })
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
