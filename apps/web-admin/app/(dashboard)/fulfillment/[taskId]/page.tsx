'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'

type TaskDetail = {
  id: string
  orderId: string
  status: string
  priority: string
  warehouseCode: string
  warehouseId?: string
  correlationId?: string
  pickItems: {
    id: string
    skuId: string
    warehouseId: string
    quantity: number
    pickedQty: number
    status: string
  }[]
}

export default function FulfillmentTaskDetailPage() {
  const params = useParams<{ taskId: string }>()
  const taskId = decodeURIComponent(params?.taskId ?? '')
  const qc = useQueryClient()

  const task = useQuery<TaskDetail>({
    queryKey: ['wms', 'task', taskId],
    queryFn: () => api.get<TaskDetail>(`/wms/tasks/${encodeURIComponent(taskId)}`),
    enabled: Boolean(taskId),
  })

  const packReq = useMutation({
    mutationKey: ['wms', 'pack', taskId],
    mutationFn: () =>
      api.post<{ status?: string; taskId?: string }>(
        `/fulfillment/tasks/${encodeURIComponent(taskId)}/pack`,
        {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wms', 'tasks'] })
      void qc.invalidateQueries({ queryKey: ['wms', 'task', taskId] })
    },
  })

  const dispatchReq = useMutation({
    mutationKey: ['wms', 'dispatch', taskId],
    mutationFn: () =>
      api.post<{ status?: string; taskId?: string }>(
        `/fulfillment/tasks/${encodeURIComponent(taskId)}/dispatch`,
        {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wms', 'tasks'] })
      void qc.invalidateQueries({ queryKey: ['wms', 'task', taskId] })
    },
  })

  const t = task.data
  const packingReady =
    t &&
    t.pickItems.length > 0 &&
    t.pickItems.every((p) => p.status === 'PICKED' || p.status === 'SHORT')

  const errPack = packReq.error instanceof Error ? packReq.error.message : null
  const errDispatch =
    dispatchReq.error instanceof Error ? dispatchReq.error.message : null

  return (
    <div className="p-6 space-y-4">
      <Link href="/fulfillment" className="text-xs text-cosmos-muted hover:text-cosmos-text">
        ← Tasks
      </Link>
      <h1 className="text-2xl font-bold text-cosmos-white">Fulfillment · task</h1>
      {!taskId ? (
        <p className="text-sm text-red-400">Missing task id.</p>
      ) : task.error ? (
        <p className="text-sm text-red-400">{(task.error as Error)?.message ?? 'Unable to load task'}</p>
      ) : null}
      {task.isLoading ? <p className="text-cosmos-muted text-sm">Loading…</p> : null}

      {t ? (
        <div className="space-y-4">
          <Card>
            <CardTitle className="font-mono text-xs truncate">{t.id}</CardTitle>
            <div className="mt-2 text-sm space-y-1 text-cosmos-muted">
              <div>
                Order{' '}
                <Link
                  href={`/orders/${encodeURIComponent(t.orderId)}`}
                  className="font-mono text-sky-300 hover:text-sky-200 underline"
                >
                  {t.orderId}
                </Link>
              </div>
              <div>
                Status <span className="text-cosmos-white font-medium">{t.status}</span>
              </div>
              <div>Warehouse {t.warehouseCode}</div>
              {t.correlationId ? (
                <div className="font-mono text-[11px] text-cosmos-muted/90">Correlation {t.correlationId}</div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <button
                type="button"
                disabled={packReq.isPending || t.status === 'PACKED' || t.status === 'DISPATCHED'}
                title={
                  packingReady
                    ? 'Mark PACKED'
                    : 'Every line must be PICKED or SHORT (update picks via mobile / sync first)'
                }
                onClick={() => void packReq.mutateAsync()}
                className="h-9 px-3 rounded-md bg-emerald-900/60 border border-emerald-700/70 text-emerald-100 text-xs disabled:opacity-40 hover:bg-emerald-800/70"
              >
                {packReq.isPending ? 'Packing…' : 'Pack'}
              </button>
              <button
                type="button"
                disabled={dispatchReq.isPending || t.status !== 'PACKED'}
                title="Requires PACKED"
                onClick={() => void dispatchReq.mutateAsync()}
                className="h-9 px-3 rounded-md bg-sky-900/60 border border-sky-700/70 text-sky-100 text-xs disabled:opacity-40 hover:bg-sky-800/70"
              >
                {dispatchReq.isPending ? 'Dispatching…' : 'Dispatch'}
              </button>
            </div>
            {errPack ? <p className="text-xs text-red-400 mt-2">{errPack}</p> : null}
            {errDispatch ? <p className="text-xs text-red-400 mt-2">{errDispatch}</p> : null}
            {!packingReady && ['PENDING', 'PICKING'].includes(t.status) ? (
              <p className="text-xs text-amber-300/90 mt-2">
                Pack is disabled until all pick lines reach PICKED or SHORT (typically via warehouse handheld).
              </p>
            ) : null}
          </Card>

          <Card>
            <CardTitle>Pick lines</CardTitle>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                    <th className="pb-2 pr-3 font-medium">Line</th>
                    <th className="pb-2 pr-3 font-medium">SKU</th>
                    <th className="pb-2 pr-3 font-medium">Qty</th>
                    <th className="pb-2 pr-3 font-medium">Picked</th>
                    <th className="pb-2 font-medium">Stat</th>
                  </tr>
                </thead>
                <tbody>
                  {t.pickItems.map((p) => (
                    <tr key={p.id} className="border-b border-cosmos-border/60">
                      <td className="py-2 pr-3 font-mono text-[11px]">{p.id.slice(0, 8)}…</td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-cosmos-text">{p.skuId}</td>
                      <td className="py-2 pr-3">{p.quantity}</td>
                      <td className="py-2 pr-3">{p.pickedQty}</td>
                      <td className="py-2 text-cosmos-white text-xs">{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
