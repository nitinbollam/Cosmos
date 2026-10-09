import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'
import { PlerosSheet } from '@/components/pleros/radix-overlays'
import { WarehouseRow, errMsg } from '../types'

export function WarehousesTab() {
  const qc = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [line1, setLine1] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [country, setCountry] = useState('US')
  const [isDefault, setIsDefault] = useState(false)

  const warehousesQ = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', 'settings'],
    queryFn: () => api.get('/warehouses'),
  })

  const createMut = useMutation({
    mutationFn: () =>
      api.post('/warehouses', {
        name: name.trim(),
        code: code.trim(),
        address: {
          line1: line1.trim(),
          city: city.trim(),
          state: state.trim(),
          postalCode: postalCode.trim(),
          ...(country.trim() ? { country: country.trim() } : {}),
        },
        isDefault,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['warehouses'] })
      setDrawerOpen(false)
      setName('')
      setCode('')
      setLine1('')
      setCity('')
      setState('')
      setPostalCode('')
      setCountry('US')
      setIsDefault(false)
    },
  })

  const defaultMut = useMutation({
    mutationFn: (id: string) => api.patch(`/warehouses/${encodeURIComponent(id)}`, { isDefault: true }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['warehouses'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-pleros-white font-semibold font-display">Warehouses</h2>
          <p className="text-pleros-text-3 text-sm mt-1">Distribution centers for receiving, picking, and fulfillment.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setDrawerOpen(true)}>
          New warehouse
        </button>
      </div>

      <div className="pleros-card overflow-x-auto">
        {warehousesQ.isLoading ? (
          <div className="skeleton h-24 w-full" />
        ) : warehousesQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(warehousesQ.error)}</p>
        ) : (warehousesQ.data ?? []).length === 0 ? (
          <EmptyState
            icon="🏭"
            title="No warehouses yet"
            description="Add at least one warehouse before receiving inventory, running cycle counts, or filtering pick tasks."
            action={
              <button type="button" className="btn-primary" onClick={() => setDrawerOpen(true)}>
                Add your first warehouse
              </button>
            }
          />
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Address</th>
                <th>Default</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(warehousesQ.data ?? []).map((w) => {
                const a = w.address as { line1?: string; city?: string; state?: string }
                const addr = [a?.line1, a?.city, a?.state].filter(Boolean).join(', ')
                return (
                  <tr key={w.id}>
                    <td className="font-mono text-xs">{w.code}</td>
                    <td>{w.name}</td>
                    <td className="text-sm text-pleros-text-2 max-w-[240px] truncate" title={addr}>
                      {addr || '—'}
                    </td>
                    <td>{w.isDefault ? <span className="text-pleros-accent text-sm">Yes</span> : '—'}</td>
                    <td className="text-right">
                      {!w.isDefault && (
                        <button
                          type="button"
                          className="btn-ghost !py-1 !px-2 !text-xs"
                          disabled={defaultMut.isPending}
                          onClick={() => defaultMut.mutate(w.id)}
                        >
                          Set as default
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <PlerosSheet open={drawerOpen} onOpenChange={setDrawerOpen} title="New warehouse">
        <label className="text-xs text-pleros-text-3">Name</label>
        <input className="pleros-input mb-3 mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="text-xs text-pleros-text-3">Code</label>
        <input className="pleros-input mb-3 mt-1 font-mono" value={code} onChange={(e) => setCode(e.target.value)} />
        <label className="text-xs text-pleros-text-3">Address line 1</label>
        <input className="pleros-input mb-3 mt-1" value={line1} onChange={(e) => setLine1(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-pleros-text-3">City</label>
            <input className="pleros-input mt-1" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-pleros-text-3">State</label>
            <input className="pleros-input mt-1" value={state} onChange={(e) => setState(e.target.value)} />
          </div>
        </div>
        <label className="text-xs text-pleros-text-3 mt-3 block">Postal code</label>
        <input className="pleros-input mb-3 mt-1" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
        <label className="text-xs text-pleros-text-3">Country</label>
        <input className="pleros-input mb-3 mt-1" value={country} onChange={(e) => setCountry(e.target.value)} />
        <label className="flex items-center gap-2 cursor-pointer mb-4">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          <span className="text-sm text-pleros-text">Set as default warehouse</span>
        </label>
        {createMut.error && <p className="text-red-400 text-sm mb-3">{errMsg(createMut.error)}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={() => setDrawerOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!name.trim() || !code.trim() || !line1.trim() || !city.trim() || !state.trim() || !postalCode.trim() || createMut.isPending}
            onClick={() => createMut.mutate()}
          >
            Create
          </button>
        </div>
      </PlerosSheet>
    </div>
  )
}
