import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { Tab, WarehouseRow } from './types'
import { PicksTab } from './tabs/picks-tab'
import { WavesTab } from './tabs/waves-tab'
import { BinsTab } from './tabs/bins-tab'
import { ReceivingTab } from './tabs/receiving-tab'
import { PutawayTab } from './tabs/putaway-tab'
import { LaborTab } from './tabs/labor-tab'
import { CountsTab } from './tabs/counts-tab'

const TAB_CONFIG: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'picks', label: 'Pick Tasks', icon: '📋' },
  { id: 'waves', label: 'Pick Waves', icon: '🌊' },
  { id: 'bins', label: 'Bin Locations', icon: '📍' },
  { id: 'receiving', label: 'Receiving', icon: '📥' },
  { id: 'putaway', label: 'Putaway', icon: '📦' },
  { id: 'labor', label: 'Labor', icon: '📊' },
  { id: 'counts', label: 'Cycle Counts', icon: '📝' },
]

export default function WarehousePage() {
  const [tab, setTab] = useState<Tab>('picks')

  const warehousesQ = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<WarehouseRow[]>('/warehouses'),
  })

  const usersQ = useQuery({
    queryKey: ['users', 'warehouse-assign'],
    queryFn: () =>
      api.get<{
        items: Array<{
          id: string
          firstName: string | null
          lastName: string | null
          email: string
          role: string
          isActive?: boolean
        }>
      }>('/users?page=1&pageSize=200'),
  })

  const userLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of usersQ.data?.items ?? []) {
      const n = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email
      m.set(u.id, n)
    }
    return m
  }, [usersQ.data])

  const warehouseLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const w of warehousesQ.data ?? []) {
      m.set(w.id, `${w.code} · ${w.name}`)
    }
    return m
  }, [warehousesQ.data])

  const warehouses = warehousesQ.data ?? []
  const users = usersQ.data?.items ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-pleros-white font-display">
          Warehouse Operations
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>
          Manage pick tasks, wave picking, bin mapping, dock receiving, directed putaway, and cycle counts.
        </p>
      </div>

      <div
        className="flex flex-wrap gap-2 p-1 rounded-xl border w-fit"
        style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
      >
        {TAB_CONFIG.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            className="btn-ghost !py-2 !px-3.5 !text-sm font-medium rounded-lg transition inline-flex items-center gap-1.5"
            style={{
              background: tab === id ? 'var(--c-primary-dim)' : 'transparent',
              color: tab === id ? 'var(--c-primary)' : 'var(--c-text-2)',
              border: tab === id ? '1px solid var(--c-primary)' : '1px solid transparent',
            }}
            onClick={() => setTab(id)}
          >
            <span>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {tab === 'picks' && (
        <PicksTab warehouses={warehouses} userLabel={userLabel} users={users} />
      )}

      {tab === 'waves' && (
        <WavesTab warehouses={warehouses} warehouseLabel={warehouseLabel} />
      )}

      {tab === 'bins' && (
        <BinsTab warehouses={warehouses} />
      )}

      {tab === 'receiving' && (
        <ReceivingTab warehouses={warehouses} warehouseLabel={warehouseLabel} />
      )}

      {tab === 'putaway' && (
        <PutawayTab warehouseLabel={warehouseLabel} />
      )}

      {tab === 'labor' && (
        <LaborTab userLabel={userLabel} />
      )}

      {tab === 'counts' && (
        <CountsTab warehouses={warehouses} warehouseLabel={warehouseLabel} />
      )}
    </div>
  )
}
