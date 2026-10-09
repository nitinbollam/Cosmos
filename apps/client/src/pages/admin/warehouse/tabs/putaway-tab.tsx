import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { showToast } from '@/lib/toast'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'
import { PutawayTaskRow, WarehouseRow } from '../types'

interface PutawayTabProps {
  warehouseLabel: Map<string, string>
}

export function PutawayTab({ warehouseLabel }: PutawayTabProps) {
  const qc = useQueryClient()

  const putawayQ = useQuery({
    queryKey: ['putaway-tasks'],
    queryFn: () => api.get<PutawayTaskRow[]>('/wms/putaway/tasks'),
  })

  const confirmPutaway = useMutation({
    mutationFn: ({ taskId, lineId }: { taskId: string; lineId: string }) =>
      api.post(`/wms/putaway/tasks/${taskId}/lines/${lineId}/confirm`, {}),
    onSuccess: () => {
      showToast('Putaway confirmed')
      void qc.invalidateQueries({ queryKey: ['putaway-tasks'] })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
        Directed putaway tasks are created when receiving sessions complete. Confirm lines to assign stock to bins.
      </p>
      <div className="pleros-card overflow-x-auto">
        {putawayQ.isLoading ? (
          <div className="space-y-2 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-12 w-full" />
            ))}
          </div>
        ) : (putawayQ.data ?? []).length === 0 ? (
          <EmptyState
            icon="📦"
            title="No putaway tasks"
            description="Complete a receiving session to generate putaway work."
          />
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Warehouse</th>
                <th>Status</th>
                <th>Lines</th>
                <th>Suggested bin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(putawayQ.data ?? []).flatMap((task) =>
                (task.lines ?? []).map((line) => (
                  <tr key={line.id}>
                    <td className="font-mono text-xs">{task.id.slice(-10)}</td>
                    <td className="text-sm">{warehouseLabel.get(task.warehouseId) ?? task.warehouseId.slice(-6)}</td>
                    <td>
                      <StatusBadge status={line.status} />
                    </td>
                    <td className="font-mono text-xs">
                      {line.skuId.slice(-8)} × {line.quantity}
                      {line.batchId ? ` · ${line.batchId}` : ''}
                    </td>
                    <td className="font-mono text-sm">{line.suggestedBinCode ?? '—'}</td>
                    <td>
                      {line.status === 'PENDING' ? (
                        <button
                          type="button"
                          className="btn-ghost !py-1.5 !px-2 !text-xs"
                          disabled={confirmPutaway.isPending}
                          onClick={() => confirmPutaway.mutate({ taskId: task.id, lineId: line.id })}
                        >
                          Confirm
                        </button>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                          {line.actualBinCode ?? 'Done'}
                        </span>
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
