import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'

type Register = { id: string; name: string; warehouseId: string | null }

export default function PosPage() {
  const qc = useQueryClient()
  const { data: registers = [] } = useQuery({
    queryKey: ['pos-registers'],
    queryFn: () => api.get<Register[]>('/pos/registers'),
  })

  const createRegister = useMutation({
    mutationFn: (name: string) => api.post<Register>('/pos/registers', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-registers'] }),
  })

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">POS registers</h2>
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
            In-store checkout via <code>POST /api/v1/pos/orders</code>
          </p>
        </div>
        <button
          type="button"
          className="cosmos-btn cosmos-btn-primary"
          onClick={() => createRegister.mutate(`Register ${registers.length + 1}`)}
        >
          Add register
        </button>
      </div>
      <ul className="divide-y rounded-lg border" style={{ borderColor: 'var(--c-border)' }}>
        {registers.map((r) => (
          <li key={r.id} className="flex items-center justify-between px-4 py-3">
            <span className="font-medium">{r.name}</span>
            <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
              {r.id.slice(-8)}
            </span>
          </li>
        ))}
        {registers.length === 0 ? <li className="px-4 py-8 text-center text-sm">No registers yet</li> : null}
      </ul>
    </div>
  )
}
