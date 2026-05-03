import './tracing-bootstrap'
﻿import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
  app.setGlobalPrefix('api/v1')
  const port = parseInt(process.env.PORT ?? '3008', 10)
  await app.listen(port)
  new Logger('storefront-service').log('storefront-service listening on :' + port)
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('storefront-service failed to start', err)
  process.exit(1)
})
