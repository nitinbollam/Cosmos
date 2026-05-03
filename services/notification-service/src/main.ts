import './tracing-bootstrap'
﻿import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true })
  app.enableShutdownHooks()
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
  app.setGlobalPrefix('api/v1')
  const port = parseInt(process.env.PORT ?? '3015', 10)
  await app.listen(port)
  new Logger('notification-service').log('notification-service listening on :' + port)
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('notification-service failed to start', err)
  process.exit(1)
})
