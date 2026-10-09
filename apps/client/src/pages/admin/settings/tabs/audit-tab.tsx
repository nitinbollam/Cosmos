import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'
import { errMsg } from '../types'

type AuditRow = {
  id: string
  userId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown> | null
  createdAt: string
}

export function AuditTab() {
  const [entityType, setEntityType] = useState('')

  const auditQ = useQuery<AuditRow[]>({
    queryKey: ['audit', entityType],
    queryFn: () => {
      const q = entityType.trim() ? `?entityType=${encodeURIComponent(entityType.trim())}&limit=100` : '?limit=100'
      return api.get(`/audit${q}`)
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-pleros-white font-semibold font-display">Audit log</h2>
        <p className="text-pleros-text-3 text-sm mt-1">Recent platform events for compliance and troubleshooting.</p>
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-pleros-text-3">Filter by entity type</label>
          <select className="pleros-input mt-1 w-48" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">All types</option>
            <option value="Order">Order</option>
            <option value="Invoice">Invoice</option>
            <option value="Payment">Payment</option>
            <option value="User">User</option>
          </select>
        </div>
      </div>
      <div className="pleros-card overflow-x-auto">
        {auditQ.isLoading ? (
          <div className="skeleton h-32 w-full" />
        ) : auditQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(auditQ.error)}</p>
        ) : (auditQ.data ?? []).length === 0 ? (
          <EmptyState icon="📋" title="No audit events" description="Actions like order shipped and payments appear here." />
        ) : (
          <table className="pleros-table text-sm">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Entity</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {(auditQ.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td className="text-pleros-text-3 whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="font-mono text-xs">{row.action}</td>
                  <td>
                    <span className="text-pleros-text-2">{row.entityType}</span>
                    {row.entityId ? (
                      <span className="font-mono text-xs text-pleros-text-3 ml-1">…{row.entityId.slice(-10)}</span>
                    ) : null}
                  </td>
                  <td className="font-mono text-xs text-pleros-text-3">{row.userId?.slice(-8) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
