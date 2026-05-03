import pino, { Logger, LoggerOptions } from 'pino'
import { nanoid } from 'nanoid'
import { AsyncLocalStorage } from 'node:async_hooks'

export interface LogContext {
  correlationId: string
  tenantId?: string
  userId?: string
  service: string
}

const correlationStorage = new AsyncLocalStorage<LogContext>()

export interface LoggerFactoryOptions {
  service: string
  level?: string
  pretty?: boolean
}

export function createLogger(options: LoggerFactoryOptions): Logger {
  const baseOptions: LoggerOptions = {
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',
    base: { service: options.service, env: process.env.NODE_ENV ?? 'development' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => ({
        pid: bindings.pid,
        hostname: bindings.hostname,
        service: bindings.service,
        env: bindings.env,
      }),
    },
    mixin() {
      const ctx = correlationStorage.getStore()
      if (!ctx) return {}
      return {
        correlationId: ctx.correlationId,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
      }
    },
    redact: {
      paths: [
        'password',
        '*.password',
        'passwordHash',
        '*.passwordHash',
        'authorization',
        'req.headers.authorization',
        'req.headers.cookie',
        '*.refreshToken',
        '*.accessToken',
        'creditCard',
        '*.creditCard',
      ],
      remove: true,
    },
  }

  if (options.pretty ?? process.env.NODE_ENV !== 'production') {
    return pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      },
    })
  }

  return pino(baseOptions)
}

export function withCorrelation<T>(ctx: Omit<LogContext, 'correlationId'> & { correlationId?: string }, fn: () => T): T {
  const correlationId = ctx.correlationId ?? nanoid()
  return correlationStorage.run({ ...ctx, correlationId }, fn)
}

export function getCorrelationContext(): LogContext | undefined {
  return correlationStorage.getStore()
}

export function newCorrelationId(): string {
  return nanoid()
}

export const logger = createLogger({ service: process.env.SERVICE_NAME ?? 'cosmos-app' })

export { Logger } from 'pino'
