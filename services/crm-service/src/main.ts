import './tracing-bootstrap'
﻿import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { AppModule } from './app.module'
import { mountPrometheusMetrics } from '@cosmos/metrics'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
  app.setGlobalPrefix('api/v1')
  mountPrometheusMetrics(app.getHttpAdapter().getInstance(), 'crm-service')
  const port = parseInt(process.env.PORT ?? '3010', 10)
  await app.listen(port)
  new Logger('crm-service').log('crm-service listening on :' + port)
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('crm-service failed to start', err)
  process.exit(1)
})
