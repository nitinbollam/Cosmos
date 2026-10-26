import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { showToast } from '@/lib/toast'
import { apiFailure, hasClientPermission, type Requisition } from '@/lib/requisitions'
import { RequisitionForm, type LinePrefill, type RequisitionPayload } from '@/components/purchasing/requisition-form'
import { useViewer } from '@/components/purchasing/use-viewer'

export default function NewRequisitionPage() {
  const [params] = useSearchParams()
  const skuId = params.get('skuId') ?? ''
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { viewer } = useViewer()

  const suppliers = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers'),
  })

  // From a low-stock alert: start with that SKU and its suggested reorder quantity.
  const suggestion = useQuery<LinePrefill | null>({
    queryKey: ['reorder-suggestion', skuId],
    enabled: !!skuId,
    retry: false,
    queryFn: async () => {
      const s = await api.get<{ sku: { code: string; name: string }; suggestedQty: number }>(`/skus/${encodeURIComponent(skuId)}/reorder-suggestion`)
      return { skuCode: s.sku.code, description: s.sku.name, qtyRequested: s.suggestedQty }
    },
  })

  const create = useMutation({
    mutationFn: (body: RequisitionPayload) => api.post<Requisition>('/purchase-requisitions', body),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['purchase-requisitions'] })
      showToast(`Requisition ${r.number} saved as a draft`, 'success')
      navigate(adminPath(`/purchasing/requisitions/${r.id}`))
    },
  })

  const waitingForPrefill = !!skuId && suggestion.isLoading

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <Link to={adminPath('/purchasing/requisitions')} className="text-sm text-pleros-muted hover:text-pleros-white">
          ← Requisitions
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-pleros-white">New requisition</h1>
        <p className="text-pleros-muted text-sm mt-1">Saved as a draft. Submit it from the next page to ask a manager for approval.</p>
      </div>
      {viewer && !hasClientPermission(viewer, 'requisitions.write') ? (
        <p className="text-sm text-pleros-muted">You can't raise requisitions. Ask an admin for requisitions access.</p>
      ) : waitingForPrefill ? (
        <p className="text-sm text-pleros-muted">Loading the low-stock item…</p>
      ) : (
        <Card>
          {skuId && suggestion.isError ? (
            <p className="text-xs text-amber-300 mb-4" role="status">
              Couldn't load the low-stock item; add it as a line yourself.
            </p>
          ) : null}
          <RequisitionForm
            prefillLine={suggestion.data ?? null}
            prefillNotes={skuId ? 'Low-stock replenishment' : ''}
            suppliers={suppliers.data ?? []}
            suppliersLoading={suppliers.isLoading}
            saving={create.isPending}
            serverError={create.error ? apiFailure(create.error).message : null}
            saveLabel="Save draft"
            onSave={(payload) => create.mutate(payload)}
          />
        </Card>
      )}
    </div>
  )
}
