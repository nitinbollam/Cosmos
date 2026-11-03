import type { Prisma } from '@/generated/prisma-tenant'
import { tenantDb } from './db'

export type AuditInput = {
  action: string
  entityType: string
  entityId?: string
  userId?: string
  metadata?: Record<string, unknown>
  /** A fixed id makes a retried write fail on the primary key instead of logging the event twice. */
  id?: string
  /** When the event happened, if it is being recorded later (e.g. delivered from an outbox). */
  createdAt?: Date
}

/** Pass `db` to write the event inside a tenant-database transaction. */
export async function auditLog(tenantId: string, input: AuditInput, db: Prisma.TransactionClient = tenantDb) {
  return db.auditEvent.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      tenantId,
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: (input.metadata ?? {}) as never,
    },
  })
}

export async function listAuditEvents(
  tenantId: string,
  filters?: { entityType?: string; entityId?: string; limit?: number },
) {
  return tenantDb.auditEvent.findMany({
    where: {
      tenantId,
      ...(filters?.entityType ? { entityType: filters.entityType } : {}),
      ...(filters?.entityId ? { entityId: filters.entityId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filters?.limit ?? 100,
  })
}
