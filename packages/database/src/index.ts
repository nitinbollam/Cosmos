import { logger } from '@cosmos/logger'

/**
 * Generic helpers shared across services. Each service owns its own
 * Prisma schema (services/*​/prisma/schema.prisma) and generates its
 * own client. This package only ships utilities that wrap or compose
 * those clients.
 */

export interface TenantScoped {
  tenantId: string
}

export function ensureTenantMatches(entity: TenantScoped | null | undefined, tenantId: string): void {
  if (!entity) {
    throw new Error('Entity not found')
  }
  if (entity.tenantId !== tenantId) {
    throw new Error('Tenant isolation violation')
  }
}

export interface RetryOptions {
  attempts?: number
  backoffMs?: number
  shouldRetry?: (err: unknown) => boolean
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3
  const backoffMs = options.backoffMs ?? 100
  const shouldRetry = options.shouldRetry ?? (() => true)

  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!shouldRetry(err) || i === attempts - 1) break
      const wait = backoffMs * Math.pow(2, i)
      logger.warn({ attempt: i + 1, wait, err: (err as Error).message }, 'db retry')
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr
}

export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002'
}

export function isNotFound(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2025'
}
