import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'

const COMMON_EVENTS = [
  { value: '*', label: 'All events' },
  { value: 'order.created', label: 'Order Created' },
  { value: 'order.fulfilled', label: 'Order Fulfilled' },
  { value: 'order.shipped', label: 'Order Shipped' },
  { value: 'order.delivered', label: 'Order Delivered' },
  { value: 'finance.payment_captured', label: 'Payment Captured' },
  { value: 'finance.invoice_generated', label: 'Invoice Generated' },
  { value: 'wms.receiving_completed', label: 'Receiving Completed' },
  { value: 'wms.shipment_dispatched', label: 'Shipment Dispatched' },
  { value: 'purchasing.po_created', label: 'Purchase Order Created' },
  { value: 'purchasing.po_received', label: 'Purchase Order Received' },
  { value: 'crm.customer_created', label: 'Customer Created' },
  { value: 'crm.lead_converted', label: 'Lead Converted' },
  { value: 'inventory.stock_level_low', label: 'Low Stock Alert' },
  { value: 'compliance.batch_recalled', label: 'Batch Recalled' },
]

type WebhookDelivery = {
  id: string
  event: string
  status: 'PENDING' | 'DELIVERED' | 'FAILED'
  attempts: number
  lastStatusCode: number | null
  lastError: string | null
  nextAttemptAt: string | null
  createdAt: string
}

/** What the last sends of one webhook were, and why any failed. */
function DeliveryLog({ subscriptionId }: { subscriptionId: string }) {
  const q = useQuery<WebhookDelivery[]>({
    queryKey: ['webhooks', subscriptionId, 'deliveries'],
    queryFn: () => api.get<WebhookDelivery[]>(`/webhooks/${subscriptionId}/deliveries?limit=10`),
    refetchInterval: 15_000,
  })
  if (q.isLoading) return <p className="text-xs mt-2" style={{ color: 'var(--c-text-3)' }}>Loading deliveries…</p>
  if (q.isError) return <p className="text-xs mt-2" style={{ color: 'var(--c-danger)' }}>Could not load deliveries.</p>
  const rows = q.data ?? []
  if (rows.length === 0) {
    return <p className="text-xs mt-2" style={{ color: 'var(--c-text-3)' }}>No events sent yet.</p>
  }
  return (
    <ul className="mt-2 space-y-1">
      {rows.map((d) => {
        const color =
          d.status === 'DELIVERED' ? 'var(--c-success)' : d.status === 'FAILED' ? 'var(--c-danger)' : 'var(--c-warning, #d97706)'
        const label = d.status === 'DELIVERED' ? 'Delivered' : d.status === 'FAILED' ? 'Gave up' : 'Retrying'
        return (
          <li key={d.id} className="text-xs font-mono flex flex-wrap gap-x-3" style={{ color: 'var(--c-text-2)' }}>
            <span style={{ color: 'var(--c-text-3)' }}>{new Date(d.createdAt).toLocaleString()}</span>
            <span>{d.event}</span>
            <span style={{ color }}>
              {label}
              {d.lastStatusCode ? ` · HTTP ${d.lastStatusCode}` : ''} · {d.attempts} attempt{d.attempts === 1 ? '' : 's'}
            </span>
            {d.status !== 'DELIVERED' && d.lastError ? <span style={{ color: 'var(--c-text-3)' }}>{d.lastError}</span> : null}
            {d.status === 'PENDING' && d.nextAttemptAt ? (
              <span style={{ color: 'var(--c-text-3)' }}>next try {new Date(d.nextAttemptAt).toLocaleTimeString()}</span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

type WebhookSub = {
  id: string
  event: string
  url: string
  description?: string
  active: boolean
  createdAt: string
}

export function WebhookManager() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ event: '*', url: '', description: '' })
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; status?: number; error?: string }>>({})
  const [openLog, setOpenLog] = useState<string | null>(null)

  const listQ = useQuery<WebhookSub[]>({
    queryKey: ['webhooks'],
    queryFn: () => api.get<WebhookSub[]>('/webhooks'),
  })

  const createMut = useMutation({
    mutationFn: (dto: typeof form) => api.post('/webhooks', dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['webhooks'] })
      setShowAdd(false)
      setForm({ event: '*', url: '', description: '' })
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/webhooks/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks'] }),
  })

  const testMut = useMutation({
    mutationFn: async (id: string) => {
      const result = await api.post<{ success: boolean; status?: number; error?: string }>(`/webhooks/${id}/test`)
      setTestResult((prev) => ({ ...prev, [id]: result }))
      return result
    },
  })

  const eventLabel = (event: string) => COMMON_EVENTS.find((e) => e.value === event)?.label ?? event

  const rows = listQ.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-pleros-white font-display">Webhook Endpoints</h3>
          <p className="text-sm mt-0.5" style={{ color: 'var(--c-text-3)' }}>
            Connect Pleros events to Workato, Zapier, or any external system.
          </p>
        </div>
        <button type="button" className="btn-primary !text-sm" onClick={() => setShowAdd(true)}>
          + Add Webhook
        </button>
      </div>

      <div className="pleros-card" style={{ borderColor: 'var(--c-primary)', background: 'var(--c-primary-dim)' }}>
        <p className="text-sm font-medium text-pleros-white mb-1">Verify webhook authenticity</p>
        <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>
          Every webhook request includes a{' '}
          <code className="font-mono" style={{ color: 'var(--c-accent)' }}>X-Pleros-Signature</code> header (HMAC-SHA256).
          In Workato, use your signing secret to verify each incoming request. Contact your administrator for the
          signing secret value.
        </p>
        <p className="text-xs mt-2" style={{ color: 'var(--c-text-2)' }}>
          Events are sent as they happen. If your endpoint doesn&apos;t answer with a 2xx, Pleros retries with backoff
          for about a day, resending the same body; skip repeats by the body&apos;s{' '}
          <code className="font-mono" style={{ color: 'var(--c-accent)' }}>id</code>.
        </p>
      </div>

      <div className="pleros-card">
        {listQ.isLoading ? (
          <div className="space-y-2 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="🔗" title="No webhooks configured" description="Add an endpoint to start receiving events." />
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--c-border)' }}>
            {rows.map((sub) => (
              <div key={sub.id} className="py-4 flex flex-wrap items-start gap-4 justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-xs font-mono px-2 py-0.5 rounded"
                      style={{ background: 'var(--c-primary-dim)', color: 'var(--c-primary)' }}
                    >
                      {eventLabel(sub.event)}
                    </span>
                    {sub.description && (
                      <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                        {sub.description}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-mono mt-1 truncate" style={{ color: 'var(--c-text-2)' }}>
                    {sub.url}
                  </p>
                  {testResult[sub.id] && (
                    <p
                      className="text-xs mt-1 font-mono"
                      style={{ color: testResult[sub.id].success ? 'var(--c-success)' : 'var(--c-danger)' }}
                    >
                      {testResult[sub.id].success
                        ? `✓ Delivered (HTTP ${testResult[sub.id].status})`
                        : `✗ Failed: ${
                            testResult[sub.id].error ??
                            (testResult[sub.id].status ? `HTTP ${testResult[sub.id].status}` : 'unknown error')
                          }`}
                    </p>
                  )}
                  {openLog === sub.id ? <DeliveryLog subscriptionId={sub.id} /> : null}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    className="btn-ghost !py-1 !px-3 !text-xs"
                    onClick={() => setOpenLog((cur) => (cur === sub.id ? null : sub.id))}
                  >
                    {openLog === sub.id ? 'Hide deliveries' : 'Deliveries'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !py-1 !px-3 !text-xs"
                    disabled={testMut.isPending}
                    onClick={() => testMut.mutate(sub.id)}
                  >
                    Test
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !py-1 !px-3 !text-xs"
                    style={{ color: 'var(--c-danger)', borderColor: 'var(--c-danger)' }}
                    disabled={deleteMut.isPending}
                    onClick={() => deleteMut.mutate(sub.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setShowAdd(false)}
        >
          <div className="pleros-card max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-pleros-white font-display mb-4">Add Webhook</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-wider mb-1 text-pleros-text-3">Event</label>
                <select
                  className="pleros-input w-full"
                  value={form.event}
                  onChange={(e) => setForm((f) => ({ ...f, event: e.target.value }))}
                >
                  {COMMON_EVENTS.map((e) => (
                    <option key={e.value} value={e.value}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider mb-1 text-pleros-text-3">Endpoint URL</label>
                <input
                  className="pleros-input w-full"
                  placeholder="https://hooks.workato.com/recipe/..."
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider mb-1 text-pleros-text-3">
                  Description (optional)
                </label>
                <input
                  className="pleros-input w-full"
                  placeholder="e.g. QuickBooks invoice sync"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-6">
              <button type="button" className="btn-ghost" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!form.url.trim() || createMut.isPending}
                onClick={() => createMut.mutate(form)}
              >
                {createMut.isPending ? 'Saving...' : 'Save Webhook'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
