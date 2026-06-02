import { tenantDb } from './db'

export type AuditInput = {
  action: string
  entityType: string
  entityId?: string
  userId?: string
  metadata?: Record<string, unknown>
}

export async function auditLog(tenantId: string, input: AuditInput) {
  return tenantDb.auditEvent.create({
    data: {
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
