import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { PlerosDialogModal } from '@/components/pleros/radix-overlays'
import { EmptyState } from '@/components/pleros/empty-state'

interface ComponentItem {
  id: string
  componentSkuId: string
  quantity: number
  scrapFactorPercent: number
  notes?: string | null
  effectiveQuantity?: number
  estimatedLineCost?: number
  componentSku?: {
    id: string
    code: string
    name: string
    category: string
    cost: number
    price: number
    unitOfMeasure: string
  } | null
}

interface Bom {
  id: string
  skuId: string
  bomNumber: string
  name: string
  description?: string | null
  version: string
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED'
  laborCost: number
  overheadCost: number
  estimatedUnitCost: number
  finishedGood?: {
    id: string
    code: string
    name: string
    category: string
    price: number
    cost: number
    unitOfMeasure: string
  } | null
  items: ComponentItem[]
  createdAt: string
}

interface AssemblyOrderItem {
  id: string
  componentSkuId: string
  quantityRequired: number
  quantityConsumed: number
  unitCost: number
  totalCost: number
  stockAvailableInWarehouse?: number
  shortage?: number
  componentSku?: {
    id: string
    code: string
    name: string
    cost: number
    unitOfMeasure: string
  } | null
}

interface AssemblyOrder {
  id: string
  orderNumber: string
  bomId: string
  skuId: string
  warehouseId: string
  destinationBinId?: string | null
  quantityPlanned: number
  quantityCompleted: number
  status: 'DRAFT' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  unitCost?: number | null
  totalCost?: number | null
  notes?: string | null
  startedAt?: string | null
  completedAt?: string | null
  createdAt: string
  itemsCount?: number
  finishedGood?: {
    id: string
    code: string
    name: string
    unitOfMeasure: string
  } | null
  warehouse?: {
    id: string
    code: string
    name: string
  } | null
  items?: AssemblyOrderItem[]
  canAssemble?: boolean
}

interface SkuOption {
  id: string
  code: string
  name: string
  cost: number
  price: number
  category: string
  unitOfMeasure: string
}

interface WarehouseOption {
  id: string
  code: string
  name: string
}

export default function ManufacturingPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'orders' | 'boms'>('orders')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  // Modals state
  const [createBomOpen, setCreateBomOpen] = useState(false)
  const [createOrderOpen, setCreateOrderOpen] = useState(false)
  const [selectedBomForOrder, setSelectedBomForOrder] = useState<Bom | null>(null)
  const [viewBomModal, setViewBomModal] = useState<Bom | null>(null)
  const [viewOrderModalId, setViewOrderModalId] = useState<string | null>(null)
  const [disassembleOpen, setDisassembleOpen] = useState(false)

  // Forms state
  const [newBomName, setNewBomName] = useState('')
  const [newBomDesc, setNewBomDesc] = useState('')
  const [newBomSkuId, setNewBomSkuId] = useState('')
  const [newBomVersion, setNewBomVersion] = useState('1.0')
  const [newBomLabor, setNewBomLabor] = useState('0')
  const [newBomOverhead, setNewBomOverhead] = useState('0')
  const [newBomLines, setNewBomLines] = useState<
    Array<{ componentSkuId: string; quantity: string; scrapFactorPercent: string }>
  >([{ componentSkuId: '', quantity: '1', scrapFactorPercent: '0' }])

  const [newOrderBomId, setNewOrderBomId] = useState('')
  const [newOrderWarehouseId, setNewOrderWarehouseId] = useState('')
  const [newOrderQty, setNewOrderQty] = useState('1')
  const [newOrderNotes, setNewOrderNotes] = useState('')

  const [disassembleSkuId, setDisassembleSkuId] = useState('')
  const [disassembleBomId, setDisassembleBomId] = useState('')
  const [disassembleWarehouseId, setDisassembleWarehouseId] = useState('')
  const [disassembleQty, setDisassembleQty] = useState('1')

  const [completeBinId, setCompleteBinId] = useState('')
  const [completeNotes, setCompleteNotes] = useState('')

  // Queries
  const { data: boms = [], isLoading: bomsLoading } = useQuery({
    queryKey: ['manufacturing', 'boms'],
    queryFn: () => api.get<Bom[]>('/manufacturing/boms'),
  })

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['manufacturing', 'orders'],
    queryFn: () => api.get<AssemblyOrder[]>('/manufacturing/orders'),
  })

  const { data: skusData } = useQuery({
    queryKey: ['manufacturing', 'skus-lookup'],
    queryFn: () => api.get<{ items: SkuOption[] }>('/skus?pageSize=300'),
  })
  const skus: SkuOption[] = useMemo(() => skusData?.items ?? [], [skusData])

  const { data: warehouses = [] } = useQuery({
    queryKey: ['manufacturing', 'warehouses'],
    queryFn: () => api.get<WarehouseOption[]>('/warehouses'),
  })

  const { data: selectedOrderDetail, isLoading: orderDetailLoading } = useQuery({
    queryKey: ['manufacturing', 'order', viewOrderModalId],
    queryFn: () => api.get<AssemblyOrder>(`/manufacturing/orders/${viewOrderModalId}`),
    enabled: Boolean(viewOrderModalId),
  })

  // Mutations
  const createBomMutation = useMutation({
    mutationFn: (data: unknown) => api.post('/manufacturing/boms', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['manufacturing', 'boms'] })
      setCreateBomOpen(false)
      resetBomForm()
    },
  })

  const createOrderMutation = useMutation({
    mutationFn: (data: unknown) => api.post('/manufacturing/orders', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['manufacturing', 'orders'] })
      setCreateOrderOpen(false)
      resetOrderForm()
    },
  })

  const releaseOrderMutation = useMutation({
    mutationFn: (orderId: string) => api.post(`/manufacturing/orders/${orderId}/release`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['manufacturing', 'orders'] })
      void qc.invalidateQueries({ queryKey: ['manufacturing', 'order', viewOrderModalId] })
    },
  })

  const completeOrderMutation = useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: unknown }) =>
      api.post(`/manufacturing/orders/${orderId}/complete`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['manufacturing', 'orders'] })
      void qc.invalidateQueries({ queryKey: ['manufacturing', 'order', viewOrderModalId] })
      void qc.invalidateQueries({ queryKey: ['inventory'] })
      setViewOrderModalId(null)
    },
  })

  const cancelOrderMutation = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason?: string }) =>
      api.post(`/manufacturing/orders/${orderId}/cancel`, { reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['manufacturing', 'orders'] })
      void qc.invalidateQueries({ queryKey: ['manufacturing', 'order', viewOrderModalId] })
      setViewOrderModalId(null)
    },
  })

  const disassembleMutation = useMutation({
    mutationFn: (data: unknown) => api.post('/manufacturing/disassemble', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['manufacturing', 'orders'] })
      void qc.invalidateQueries({ queryKey: ['inventory'] })
      setDisassembleOpen(false)
      setDisassembleQty('1')
    },
  })

  // Helpers & Form Resets
  function resetBomForm() {
    setNewBomName('')
    setNewBomDesc('')
    setNewBomSkuId('')
    setNewBomVersion('1.0')
    setNewBomLabor('0')
    setNewBomOverhead('0')
    setNewBomLines([{ componentSkuId: '', quantity: '1', scrapFactorPercent: '0' }])
  }

  function resetOrderForm() {
    setNewOrderBomId('')
    setNewOrderWarehouseId('')
    setNewOrderQty('1')
    setNewOrderNotes('')
    setSelectedBomForOrder(null)
  }

  // Cost estimate preview for new BOM
  const newBomCostPreview = useMemo(() => {
    let partsCost = 0
    for (const line of newBomLines) {
      const comp = skus.find((s) => s.id === line.componentSkuId)
      const qty = parseFloat(line.quantity) || 0
      const scrap = parseFloat(line.scrapFactorPercent) || 0
      const cost = comp ? Number(comp.cost) : 0
      partsCost += qty * (1 + scrap / 100) * cost
    }
    const labor = parseFloat(newBomLabor) || 0
    const overhead = parseFloat(newBomOverhead) || 0
    return {
      partsCost,
      labor,
      overhead,
      total: partsCost + labor + overhead,
    }
  }, [newBomLines, newBomLabor, newBomOverhead, skus])

  // Filtered lists
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== 'ALL' && o.status !== statusFilter) return false
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (
        o.orderNumber.toLowerCase().includes(q) ||
        o.finishedGood?.code.toLowerCase().includes(q) ||
        o.finishedGood?.name.toLowerCase().includes(q) ||
        o.warehouse?.name.toLowerCase().includes(q)
      )
    })
  }, [orders, statusFilter, search])

  const filteredBoms = useMemo(() => {
    return boms.filter((b) => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (
        b.bomNumber.toLowerCase().includes(q) ||
        b.name.toLowerCase().includes(q) ||
        b.finishedGood?.code.toLowerCase().includes(q) ||
        b.finishedGood?.name.toLowerCase().includes(q)
      )
    })
  }, [boms, search])

  // Metrics
  const activeOrdersCount = orders.filter((o) => o.status === 'RELEASED' || o.status === 'IN_PROGRESS').length
  const completedOrdersCount = orders.filter((o) => o.status === 'COMPLETED').length
  const plannedUnits = orders
    .filter((o) => o.status !== 'CANCELLED')
    .reduce((acc, o) => acc + o.quantityPlanned, 0)

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-pleros-white font-display">
              Manufacturing & Kitting
            </h1>
            <span
              className="text-xs font-semibold px-2.5 py-0.5 rounded-full border"
              style={{
                borderColor: 'rgba(56, 189, 248, 0.3)',
                background: 'rgba(56, 189, 248, 0.1)',
                color: '#38bdf8',
              }}
            >
              Enterprise Tier
            </span>
          </div>
          <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>
            Configure Bill of Materials (BOM) recipes, track component shortages, and assemble finished goods.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className="btn-ghost !py-2 !px-3.5 !text-sm font-medium rounded-lg transition inline-flex items-center gap-1.5 border"
            style={{ borderColor: 'var(--c-border-card)', color: 'var(--c-text-2)' }}
            onClick={() => setDisassembleOpen(true)}
          >
            <span>🔄</span>
            <span>Dekit / Disassemble</span>
          </button>
          <button
            type="button"
            className="btn-ghost !py-2 !px-3.5 !text-sm font-medium rounded-lg transition inline-flex items-center gap-1.5 border"
            style={{ borderColor: 'var(--c-border-card)', color: 'var(--c-text-1)' }}
            onClick={() => {
              resetBomForm()
              setCreateBomOpen(true)
            }}
          >
            <span>📜</span>
            <span>+ New BOM</span>
          </button>
          <button
            type="button"
            className="btn-primary !py-2 !px-4 !text-sm font-semibold rounded-lg shadow-sm transition inline-flex items-center gap-1.5"
            onClick={() => {
              resetOrderForm()
              setCreateOrderOpen(true)
            }}
          >
            <span>⚡</span>
            <span>+ Assemble Order</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          className="p-4 rounded-xl border pleros-card"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          <div className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
            Active Assembly Orders
          </div>
          <div className="text-2xl font-bold mt-1 text-pleros-white tabular-nums">
            {activeOrdersCount}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>
            {orders.filter((o) => o.status === 'DRAFT').length} in draft status
          </div>
        </div>

        <div
          className="p-4 rounded-xl border pleros-card"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          <div className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
            Completed Orders
          </div>
          <div className="text-2xl font-bold mt-1 text-emerald-400 tabular-nums">
            {completedOrdersCount}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>
            Stock produced & components consumed
          </div>
        </div>

        <div
          className="p-4 rounded-xl border pleros-card"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          <div className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
            Planned Production Units
          </div>
          <div className="text-2xl font-bold mt-1 text-pleros-white tabular-nums">
            {plannedUnits}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>
            Finished goods across orders
          </div>
        </div>

        <div
          className="p-4 rounded-xl border pleros-card"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          <div className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
            Active BOM Recipes
          </div>
          <div className="text-2xl font-bold mt-1 text-sky-400 tabular-nums">
            {boms.filter((b) => b.status === 'ACTIVE').length}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>
            Multi-component assembly specs
          </div>
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
        <div
          className="flex p-1 rounded-xl border w-fit"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          <button
            type="button"
            className="btn-ghost !py-2 !px-4 !text-sm font-medium rounded-lg transition inline-flex items-center gap-2"
            style={{
              background: tab === 'orders' ? 'var(--c-primary-dim)' : 'transparent',
              color: tab === 'orders' ? 'var(--c-primary)' : 'var(--c-text-2)',
              border: tab === 'orders' ? '1px solid var(--c-primary)' : '1px solid transparent',
            }}
            onClick={() => setTab('orders')}
          >
            <span>⚙️</span>
            <span>Assembly Work Orders</span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--c-border-card)', color: 'var(--c-text-3)' }}
            >
              {orders.length}
            </span>
          </button>
          <button
            type="button"
            className="btn-ghost !py-2 !px-4 !text-sm font-medium rounded-lg transition inline-flex items-center gap-2"
            style={{
              background: tab === 'boms' ? 'var(--c-primary-dim)' : 'transparent',
              color: tab === 'boms' ? 'var(--c-primary)' : 'var(--c-text-2)',
              border: tab === 'boms' ? '1px solid var(--c-primary)' : '1px solid transparent',
            }}
            onClick={() => setTab('boms')}
          >
            <span>📋</span>
            <span>Bill of Materials (BOM)</span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--c-border-card)', color: 'var(--c-text-3)' }}
            >
              {boms.length}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          {tab === 'orders' && (
            <select
              className="pleros-input text-xs !py-1.5 !px-3 rounded-lg border"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="RELEASED">Released</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          )}

          <input
            type="text"
            className="pleros-input text-xs !py-1.5 !px-3 rounded-lg border w-48 sm:w-64"
            style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
            placeholder="Search SKU or order #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Tab Content: Assembly Orders */}
      {tab === 'orders' && (
        <div
          className="border rounded-xl overflow-hidden pleros-card"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          {ordersLoading ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--c-text-3)' }}>
              Loading assembly orders…
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon="⚡"
                title="No assembly orders found"
                description={
                  search || statusFilter !== 'ALL'
                    ? 'No orders match your filter criteria.'
                    : 'Create your first assembly work order to convert raw parts into finished goods.'
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr
                    className="border-b text-xs font-semibold uppercase tracking-wider"
                    style={{ borderColor: 'var(--c-border-card)', color: 'var(--c-text-3)' }}
                  >
                    <th className="py-3 px-4">Order #</th>
                    <th className="py-3 px-4">Finished Good</th>
                    <th className="py-3 px-4">Warehouse</th>
                    <th className="py-3 px-4 text-center">Planned</th>
                    <th className="py-3 px-4 text-center">Completed</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Rolled Unit Cost</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--c-border-card)' }}>
                  {filteredOrders.map((o) => (
                    <tr
                      key={o.id}
                      className="hover:bg-white/[0.02] transition cursor-pointer"
                      onClick={() => setViewOrderModalId(o.id)}
                    >
                      <td className="py-3.5 px-4 font-mono font-medium text-pleros-white">
                        {o.orderNumber}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-pleros-white">
                          {o.finishedGood?.name ?? 'Unknown Finished Good'}
                        </div>
                        <div className="text-xs font-mono" style={{ color: 'var(--c-text-3)' }}>
                          {o.finishedGood?.code}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs" style={{ color: 'var(--c-text-2)' }}>
                        {o.warehouse ? `${o.warehouse.code} · ${o.warehouse.name}` : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-center tabular-nums font-semibold text-pleros-white">
                        {o.quantityPlanned}
                      </td>
                      <td className="py-3.5 px-4 text-center tabular-nums font-semibold">
                        <span className={o.quantityCompleted > 0 ? 'text-emerald-400' : 'text-pleros-text-3'}>
                          {o.quantityCompleted}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${
                            o.status === 'COMPLETED'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : o.status === 'RELEASED'
                              ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                              : o.status === 'CANCELLED'
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {o.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right tabular-nums text-xs" style={{ color: 'var(--c-text-2)' }}>
                        {o.unitCost != null ? `$${o.unitCost.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="btn-ghost !py-1 !px-2.5 !text-xs font-medium rounded-md border"
                          style={{ borderColor: 'var(--c-border-card)', color: 'var(--c-primary)' }}
                          onClick={() => setViewOrderModalId(o.id)}
                        >
                          Details & Assembly →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: BOM Recipes */}
      {tab === 'boms' && (
        <div
          className="border rounded-xl overflow-hidden pleros-card"
          style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
        >
          {bomsLoading ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--c-text-3)' }}>
              Loading Bill of Materials recipes…
            </div>
          ) : filteredBoms.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon="📋"
                title="No Bill of Materials recipes"
                description="Create a BOM recipe to define how finished goods are built from raw materials and components."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr
                    className="border-b text-xs font-semibold uppercase tracking-wider"
                    style={{ borderColor: 'var(--c-border-card)', color: 'var(--c-text-3)' }}
                  >
                    <th className="py-3 px-4">BOM #</th>
                    <th className="py-3 px-4">Recipe Name</th>
                    <th className="py-3 px-4">Finished Good SKU</th>
                    <th className="py-3 px-4 text-center">Version</th>
                    <th className="py-3 px-4 text-center">Components</th>
                    <th className="py-3 px-4 text-right">Labor + Overhead</th>
                    <th className="py-3 px-4 text-right">Rolled Unit Cost</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--c-border-card)' }}>
                  {filteredBoms.map((b) => (
                    <tr
                      key={b.id}
                      className="hover:bg-white/[0.02] transition cursor-pointer"
                      onClick={() => setViewBomModal(b)}
                    >
                      <td className="py-3.5 px-4 font-mono font-medium text-pleros-white">
                        {b.bomNumber}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-pleros-white">{b.name}</div>
                        {b.description && (
                          <div className="text-xs truncate max-w-xs" style={{ color: 'var(--c-text-3)' }}>
                            {b.description}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-pleros-white">
                          {b.finishedGood?.name ?? 'Unknown Finished Good'}
                        </div>
                        <div className="text-xs font-mono" style={{ color: 'var(--c-text-3)' }}>
                          {b.finishedGood?.code}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center text-xs font-mono" style={{ color: 'var(--c-text-2)' }}>
                        v{b.version}
                      </td>
                      <td className="py-3.5 px-4 text-center tabular-nums font-semibold text-pleros-white">
                        {b.items.length} parts
                      </td>
                      <td className="py-3.5 px-4 text-right tabular-nums text-xs" style={{ color: 'var(--c-text-2)' }}>
                        ${(b.laborCost + b.overheadCost).toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-right tabular-nums font-semibold text-emerald-400">
                        ${b.estimatedUnitCost.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="btn-ghost !py-1 !px-2.5 !text-xs font-medium rounded-md border"
                            style={{ borderColor: 'var(--c-border-card)', color: 'var(--c-text-2)' }}
                            onClick={() => setViewBomModal(b)}
                          >
                            View Recipe
                          </button>
                          <button
                            type="button"
                            className="btn-primary !py-1 !px-2.5 !text-xs font-semibold rounded-md shadow-sm"
                            onClick={() => {
                              setSelectedBomForOrder(b)
                              setNewOrderBomId(b.id)
                              setCreateOrderOpen(true)
                            }}
                          >
                            + Work Order
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* MODAL: Create New BOM Recipe                                        */}
      {/* ------------------------------------------------------------------ */}
      <PlerosDialogModal
        open={createBomOpen}
        onOpenChange={setCreateBomOpen}
        title="Create Bill of Materials (BOM) Recipe"
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
            Define the component parts, quantities, scrap allowances, and labor required to manufacture one unit of a finished good.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold block mb-1 text-pleros-white">
                Finished Good SKU *
              </label>
              <select
                className="pleros-input text-xs w-full"
                value={newBomSkuId}
                onChange={(e) => setNewBomSkuId(e.target.value)}
              >
                <option value="">Select finished good SKU…</option>
                {skus.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name} ({s.category})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold block mb-1 text-pleros-white">
                BOM Recipe Name *
              </label>
              <input
                type="text"
                className="pleros-input text-xs w-full"
                placeholder="e.g. Standard Solar Generator Assembly"
                value={newBomName}
                onChange={(e) => setNewBomName(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold block mb-1 text-pleros-white">Version</label>
              <input
                type="text"
                className="pleros-input text-xs w-full"
                value={newBomVersion}
                onChange={(e) => setNewBomVersion(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1 text-pleros-white">
                Labor Cost per Unit ($)
              </label>
              <input
                type="number"
                step="0.01"
                className="pleros-input text-xs w-full"
                value={newBomLabor}
                onChange={(e) => setNewBomLabor(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1 text-pleros-white">
                Overhead Cost per Unit ($)
              </label>
              <input
                type="number"
                step="0.01"
                className="pleros-input text-xs w-full"
                value={newBomOverhead}
                onChange={(e) => setNewBomOverhead(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold block mb-1 text-pleros-white">Description / Notes</label>
            <textarea
              className="pleros-input text-xs w-full h-16 resize-none"
              placeholder="Assembly instructions, engineering change notes, or packaging specs…"
              value={newBomDesc}
              onChange={(e) => setNewBomDesc(e.target.value)}
            />
          </div>

          {/* Component Lines Table */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-pleros-white">
                Component Parts (Per 1 Finished Good)
              </span>
              <button
                type="button"
                className="text-xs font-medium text-sky-400 hover:underline"
                onClick={() =>
                  setNewBomLines([...newBomLines, { componentSkuId: '', quantity: '1', scrapFactorPercent: '0' }])
                }
              >
                + Add Component
              </button>
            </div>

            <div
              className="border rounded-lg overflow-hidden divide-y"
              style={{ borderColor: 'var(--c-border-card)' }}
            >
              <div
                className="grid grid-cols-12 gap-2 p-2 text-xs font-semibold"
                style={{ background: 'var(--c-surface-sunken)', color: 'var(--c-text-3)' }}
              >
                <div className="col-span-6">Component SKU</div>
                <div className="col-span-2 text-center">Qty</div>
                <div className="col-span-2 text-center">Scrap %</div>
                <div className="col-span-2 text-right">Line Cost</div>
              </div>

              {newBomLines.map((line, idx) => {
                const comp = skus.find((s) => s.id === line.componentSkuId)
                const qty = parseFloat(line.quantity) || 0
                const scrap = parseFloat(line.scrapFactorPercent) || 0
                const lineCost = comp ? qty * (1 + scrap / 100) * Number(comp.cost) : 0

                return (
                  <div key={idx} className="grid grid-cols-12 gap-2 p-2 items-center text-xs">
                    <div className="col-span-6">
                      <select
                        className="pleros-input text-xs w-full"
                        value={line.componentSkuId}
                        onChange={(e) => {
                          const updated = [...newBomLines]
                          updated[idx].componentSkuId = e.target.value
                          setNewBomLines(updated)
                        }}
                      >
                        <option value="">Select component SKU…</option>
                        {skus
                          .filter((s) => s.id !== newBomSkuId)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.code} · {s.name} (${Number(s.cost).toFixed(2)})
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="col-span-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="pleros-input text-xs w-full text-center"
                        value={line.quantity}
                        onChange={(e) => {
                          const updated = [...newBomLines]
                          updated[idx].quantity = e.target.value
                          setNewBomLines(updated)
                        }}
                      />
                    </div>

                    <div className="col-span-2">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        className="pleros-input text-xs w-full text-center"
                        value={line.scrapFactorPercent}
                        onChange={(e) => {
                          const updated = [...newBomLines]
                          updated[idx].scrapFactorPercent = e.target.value
                          setNewBomLines(updated)
                        }}
                      />
                    </div>

                    <div className="col-span-2 flex items-center justify-end gap-1.5 tabular-nums">
                      <span className="font-medium text-pleros-white">${lineCost.toFixed(2)}</span>
                      {newBomLines.length > 1 && (
                        <button
                          type="button"
                          className="text-rose-400 hover:text-rose-300 font-bold px-1"
                          onClick={() => setNewBomLines(newBomLines.filter((_, i) => i !== idx))}
                          title="Remove line"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Cost roll-up banner */}
          <div
            className="p-3.5 rounded-lg border flex items-center justify-between"
            style={{
              borderColor: 'rgba(56, 189, 248, 0.3)',
              background: 'rgba(56, 189, 248, 0.05)',
            }}
          >
            <div>
              <div className="text-xs font-semibold text-pleros-white">Estimated Production Cost Roll-Up</div>
              <div className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                Parts: ${newBomCostPreview.partsCost.toFixed(2)} + Labor: ${newBomCostPreview.labor.toFixed(2)} + Overhead: ${newBomCostPreview.overhead.toFixed(2)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-sky-400 tabular-nums">
                ${newBomCostPreview.total.toFixed(2)}
              </div>
              <div className="text-[10px] uppercase font-semibold text-sky-300">Per Assembled Unit</div>
            </div>
          </div>

          {createBomMutation.isError && (
            <div className="text-xs text-rose-400 p-2 rounded bg-rose-500/10 border border-rose-500/20">
              {(createBomMutation.error as Error)?.message || 'Failed to create BOM'}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--c-border-card)' }}>
            <button
              type="button"
              className="btn-ghost !py-2 !px-4 !text-xs font-medium rounded-lg"
              onClick={() => setCreateBomOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary !py-2 !px-4 !text-xs font-semibold rounded-lg shadow-sm"
              disabled={
                !newBomSkuId ||
                !newBomName.trim() ||
                newBomLines.some((l) => !l.componentSkuId) ||
                createBomMutation.isPending
              }
              onClick={() => {
                createBomMutation.mutate({
                  skuId: newBomSkuId,
                  name: newBomName,
                  description: newBomDesc,
                  version: newBomVersion,
                  laborCost: parseFloat(newBomLabor) || 0,
                  overheadCost: parseFloat(newBomOverhead) || 0,
                  items: newBomLines.map((l) => ({
                    componentSkuId: l.componentSkuId,
                    quantity: parseFloat(l.quantity) || 1,
                    scrapFactorPercent: parseFloat(l.scrapFactorPercent) || 0,
                  })),
                })
              }}
            >
              {createBomMutation.isPending ? 'Saving BOM…' : 'Save BOM Recipe'}
            </button>
          </div>
        </div>
      </PlerosDialogModal>

      {/* ------------------------------------------------------------------ */}
      {/* MODAL: Create New Assembly Order                                   */}
      {/* ------------------------------------------------------------------ */}
      <PlerosDialogModal
        open={createOrderOpen}
        onOpenChange={setCreateOrderOpen}
        title="Create Assembly Work Order"
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
            Initiate an assembly work order to produce finished goods from component parts according to the selected BOM recipe.
          </p>

          <div>
            <label className="text-xs font-semibold block mb-1 text-pleros-white">
              BOM Recipe *
            </label>
            <select
              className="pleros-input text-xs w-full"
              value={newOrderBomId}
              onChange={(e) => {
                setNewOrderBomId(e.target.value)
                const found = boms.find((b) => b.id === e.target.value)
                setSelectedBomForOrder(found ?? null)
              }}
            >
              <option value="">Select BOM recipe…</option>
              {boms
                .filter((b) => b.status === 'ACTIVE')
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bomNumber} · {b.name} ({b.finishedGood?.name})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold block mb-1 text-pleros-white">
              Target Assembly Warehouse *
            </label>
            <select
              className="pleros-input text-xs w-full"
              value={newOrderWarehouseId}
              onChange={(e) => setNewOrderWarehouseId(e.target.value)}
            >
              <option value="">Select warehouse location…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold block mb-1 text-pleros-white">
              Planned Finished Goods Quantity *
            </label>
            <input
              type="number"
              min="1"
              step="1"
              className="pleros-input text-xs w-full"
              value={newOrderQty}
              onChange={(e) => setNewOrderQty(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-semibold block mb-1 text-pleros-white">Notes / Batch Label</label>
            <input
              type="text"
              className="pleros-input text-xs w-full"
              placeholder="e.g. Q4 Stock Replenishment batch"
              value={newOrderNotes}
              onChange={(e) => setNewOrderNotes(e.target.value)}
            />
          </div>

          {selectedBomForOrder && (
            <div
              className="p-3 rounded-lg border text-xs"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface-sunken)' }}
            >
              <div className="font-semibold text-pleros-white mb-1">Recipe Requirements Preview:</div>
              <ul className="space-y-1" style={{ color: 'var(--c-text-2)' }}>
                {selectedBomForOrder.items.map((i) => {
                  const needed = (parseFloat(newOrderQty) || 1) * i.quantity
                  return (
                    <li key={i.id} className="flex justify-between">
                      <span>• {i.componentSku?.name ?? i.componentSkuId}</span>
                      <span className="font-mono tabular-nums font-semibold text-pleros-white">
                        {needed} {i.componentSku?.unitOfMeasure ?? 'units'}
                      </span>
                    </li>
                  )
                })}
              </ul>
              <div className="mt-2 pt-2 border-t flex justify-between font-semibold" style={{ borderColor: 'var(--c-border-card)' }}>
                <span>Estimated Unit Cost:</span>
                <span className="text-emerald-400 tabular-nums">
                  ${selectedBomForOrder.estimatedUnitCost.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {createOrderMutation.isError && (
            <div className="text-xs text-rose-400 p-2 rounded bg-rose-500/10 border border-rose-500/20">
              {(createOrderMutation.error as Error)?.message || 'Failed to create assembly order'}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--c-border-card)' }}>
            <button
              type="button"
              className="btn-ghost !py-2 !px-4 !text-xs font-medium rounded-lg"
              onClick={() => setCreateOrderOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary !py-2 !px-4 !text-xs font-semibold rounded-lg shadow-sm"
              disabled={
                !newOrderBomId ||
                !newOrderWarehouseId ||
                parseInt(newOrderQty) < 1 ||
                createOrderMutation.isPending
              }
              onClick={() => {
                createOrderMutation.mutate({
                  bomId: newOrderBomId,
                  warehouseId: newOrderWarehouseId,
                  quantityPlanned: parseInt(newOrderQty, 10),
                  notes: newOrderNotes,
                })
              }}
            >
              {createOrderMutation.isPending ? 'Creating Order…' : 'Create Work Order'}
            </button>
          </div>
        </div>
      </PlerosDialogModal>

      {/* ------------------------------------------------------------------ */}
      {/* MODAL: View BOM Recipe Details                                     */}
      {/* ------------------------------------------------------------------ */}
      <PlerosDialogModal
        open={Boolean(viewBomModal)}
        onOpenChange={(open) => !open && setViewBomModal(null)}
        title={viewBomModal ? `${viewBomModal.bomNumber} — ${viewBomModal.name}` : 'BOM Recipe'}
        maxWidthClass="max-w-2xl"
      >
        {viewBomModal && (
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-base text-pleros-white">
                  {viewBomModal.finishedGood?.name}
                </h3>
                <div className="text-xs font-mono" style={{ color: 'var(--c-text-3)' }}>
                  SKU: {viewBomModal.finishedGood?.code} · Version: v{viewBomModal.version}
                </div>
              </div>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  viewBomModal.status === 'ACTIVE'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20'
                }`}
              >
                {viewBomModal.status}
              </span>
            </div>

            {viewBomModal.description && (
              <p className="text-xs p-2.5 rounded-lg border" style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface-sunken)', color: 'var(--c-text-2)' }}>
                {viewBomModal.description}
              </p>
            )}

            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2 text-pleros-white">
                Component Parts Breakdown
              </div>
              <div className="border rounded-lg overflow-hidden divide-y" style={{ borderColor: 'var(--c-border-card)' }}>
                <div
                  className="grid grid-cols-12 gap-2 p-2.5 text-xs font-semibold"
                  style={{ background: 'var(--c-surface-sunken)', color: 'var(--c-text-3)' }}
                >
                  <div className="col-span-5">Component</div>
                  <div className="col-span-2 text-center">Qty / Kit</div>
                  <div className="col-span-2 text-right">Part Cost</div>
                  <div className="col-span-3 text-right">Line Subtotal</div>
                </div>
                {viewBomModal.items.map((item) => (
                  <div key={item.id} className="grid grid-cols-12 gap-2 p-2.5 items-center text-xs">
                    <div className="col-span-5">
                      <div className="font-medium text-pleros-white">{item.componentSku?.name}</div>
                      <div className="text-[11px] font-mono" style={{ color: 'var(--c-text-3)' }}>
                        {item.componentSku?.code}
                      </div>
                    </div>
                    <div className="col-span-2 text-center tabular-nums font-semibold text-pleros-white">
                      {item.quantity} {item.componentSku?.unitOfMeasure}
                    </div>
                    <div className="col-span-2 text-right tabular-nums" style={{ color: 'var(--c-text-2)' }}>
                      ${(item.componentSku?.cost ?? 0).toFixed(2)}
                    </div>
                    <div className="col-span-3 text-right tabular-nums font-semibold text-pleros-white">
                      ${((item.estimatedLineCost ?? (item.quantity * (item.componentSku?.cost ?? 0)))).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cost Summary Box */}
            <div
              className="p-3.5 rounded-lg border grid grid-cols-3 gap-2 text-center text-xs"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface-sunken)' }}
            >
              <div>
                <div style={{ color: 'var(--c-text-3)' }}>Labor Cost</div>
                <div className="font-semibold text-pleros-white mt-0.5">${viewBomModal.laborCost.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ color: 'var(--c-text-3)' }}>Overhead</div>
                <div className="font-semibold text-pleros-white mt-0.5">${viewBomModal.overheadCost.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ color: 'var(--c-text-3)' }}>Rolled-Up Unit Cost</div>
                <div className="font-bold text-emerald-400 mt-0.5">${viewBomModal.estimatedUnitCost.toFixed(2)}</div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--c-border-card)' }}>
              <button
                type="button"
                className="btn-ghost !py-2 !px-4 !text-xs font-medium rounded-lg"
                onClick={() => setViewBomModal(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-primary !py-2 !px-4 !text-xs font-semibold rounded-lg shadow-sm"
                onClick={() => {
                  setSelectedBomForOrder(viewBomModal)
                  setNewOrderBomId(viewBomModal.id)
                  setViewBomModal(null)
                  setCreateOrderOpen(true)
                }}
              >
                + Create Work Order from Recipe
              </button>
            </div>
          </div>
        )}
      </PlerosDialogModal>

      {/* ------------------------------------------------------------------ */}
      {/* MODAL: View Order Detail & Assembly Execution                      */}
      {/* ------------------------------------------------------------------ */}
      <PlerosDialogModal
        open={Boolean(viewOrderModalId)}
        onOpenChange={(open) => !open && setViewOrderModalId(null)}
        title={selectedOrderDetail ? `Work Order: ${selectedOrderDetail.orderNumber}` : 'Work Order'}
        maxWidthClass="max-w-3xl"
      >
        {orderDetailLoading || !selectedOrderDetail ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--c-text-3)' }}>
            Loading order details & verifying component stock…
          </div>
        ) : (
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg border" style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface-sunken)' }}>
              <div>
                <div className="text-xs" style={{ color: 'var(--c-text-3)' }}>Target Finished Good</div>
                <div className="font-bold text-pleros-white">{selectedOrderDetail.finishedGood?.name}</div>
                <div className="text-xs font-mono" style={{ color: 'var(--c-text-3)' }}>
                  SKU: {selectedOrderDetail.finishedGood?.code} · Warehouse: {selectedOrderDetail.warehouse?.name}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs" style={{ color: 'var(--c-text-3)' }}>Planned Quantity</div>
                  <div className="text-xl font-bold text-pleros-white tabular-nums">
                    {selectedOrderDetail.quantityPlanned} units
                  </div>
                </div>
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    selectedOrderDetail.status === 'COMPLETED'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : selectedOrderDetail.status === 'RELEASED'
                      ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }`}
                >
                  {selectedOrderDetail.status}
                </span>
              </div>
            </div>

            {/* Component Availability Matrix */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-pleros-white">
                  Component Availability & Shortage Analysis
                </span>
                {selectedOrderDetail.status !== 'COMPLETED' && (
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      selectedOrderDetail.canAssemble
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-rose-500/10 text-rose-400'
                    }`}
                  >
                    {selectedOrderDetail.canAssemble
                      ? '✓ All Components in Stock'
                      : '⚠ Shortages Detected'}
                  </span>
                )}
              </div>

              <div className="border rounded-lg overflow-hidden divide-y" style={{ borderColor: 'var(--c-border-card)' }}>
                <div
                  className="grid grid-cols-12 gap-2 p-2.5 text-xs font-semibold"
                  style={{ background: 'var(--c-surface-sunken)', color: 'var(--c-text-3)' }}
                >
                  <div className="col-span-5">Component Part</div>
                  <div className="col-span-2 text-center">Required</div>
                  <div className="col-span-2 text-center">In Warehouse</div>
                  <div className="col-span-3 text-right">Stock Status</div>
                </div>

                {selectedOrderDetail.items?.map((item) => {
                  const isCompleted = selectedOrderDetail.status === 'COMPLETED'
                  const shortage = item.shortage ?? 0
                  const isShort = !isCompleted && shortage > 0

                  return (
                    <div key={item.id} className="grid grid-cols-12 gap-2 p-2.5 items-center text-xs">
                      <div className="col-span-5">
                        <div className="font-medium text-pleros-white">{item.componentSku?.name}</div>
                        <div className="text-[11px] font-mono" style={{ color: 'var(--c-text-3)' }}>
                          {item.componentSku?.code}
                        </div>
                      </div>

                      <div className="col-span-2 text-center tabular-nums font-semibold text-pleros-white">
                        {item.quantityRequired} {item.componentSku?.unitOfMeasure}
                      </div>

                      <div className="col-span-2 text-center tabular-nums font-semibold">
                        {isCompleted ? (
                          <span className="text-emerald-400">{item.quantityConsumed} consumed</span>
                        ) : (
                          <span className={item.stockAvailableInWarehouse! >= item.quantityRequired ? 'text-pleros-white' : 'text-rose-400'}>
                            {item.stockAvailableInWarehouse} avail
                          </span>
                        )}
                      </div>

                      <div className="col-span-3 text-right">
                        {isCompleted ? (
                          <span className="text-xs font-semibold text-emerald-400">✓ Deducted from stock</span>
                        ) : isShort ? (
                          <span className="text-xs font-semibold text-rose-400">
                            ⚠ Short by {shortage} units
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-400">✓ Ready to assemble</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Execution / Actions Form if not completed */}
            {selectedOrderDetail.status !== 'COMPLETED' && selectedOrderDetail.status !== 'CANCELLED' && (
              <div
                className="p-4 rounded-xl border space-y-3"
                style={{
                  borderColor: selectedOrderDetail.canAssemble ? 'rgba(56, 189, 248, 0.4)' : 'var(--c-border-card)',
                  background: 'var(--c-surface)',
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-pleros-white">
                    Execute Assembly & Inventory Conversion
                  </div>
                  <div className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                    Atomic deduction of parts + receipt of finished goods
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold block mb-1 text-pleros-white">
                      Destination Bin Location (Optional)
                    </label>
                    <input
                      type="text"
                      className="pleros-input text-xs w-full"
                      placeholder="e.g. A-01-02"
                      value={completeBinId}
                      onChange={(e) => setCompleteBinId(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold block mb-1 text-pleros-white">
                      Execution Notes
                    </label>
                    <input
                      type="text"
                      className="pleros-input text-xs w-full"
                      placeholder="e.g. Batch inspected and packed"
                      value={completeNotes}
                      onChange={(e) => setCompleteNotes(e.target.value)}
                    />
                  </div>
                </div>

                {completeOrderMutation.isError && (
                  <div className="text-xs text-rose-400 p-2 rounded bg-rose-500/10 border border-rose-500/20">
                    {(completeOrderMutation.error as Error)?.message || 'Failed to complete assembly order'}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    className="btn-ghost !py-2 !px-3 !text-xs font-medium text-rose-400 hover:text-rose-300"
                    onClick={() => {
                      if (confirm('Are you sure you want to cancel this assembly order?')) {
                        cancelOrderMutation.mutate({ orderId: selectedOrderDetail.id })
                      }
                    }}
                  >
                    Cancel Order
                  </button>

                  <div className="flex items-center gap-2">
                    {selectedOrderDetail.status === 'DRAFT' && (
                      <button
                        type="button"
                        className="btn-ghost !py-2 !px-4 !text-xs font-medium rounded-lg border"
                        style={{ borderColor: 'var(--c-border-card)' }}
                        onClick={() => releaseOrderMutation.mutate(selectedOrderDetail.id)}
                      >
                        Release Order
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn-primary !py-2 !px-5 !text-xs font-semibold rounded-lg shadow-sm"
                      disabled={!selectedOrderDetail.canAssemble || completeOrderMutation.isPending}
                      onClick={() => {
                        completeOrderMutation.mutate({
                          orderId: selectedOrderDetail.id,
                          data: {
                            destinationBinId: completeBinId || undefined,
                            notes: completeNotes || undefined,
                          },
                        })
                      }}
                    >
                      {completeOrderMutation.isPending
                        ? 'Executing Assembly…'
                        : selectedOrderDetail.canAssemble
                        ? `✓ Assemble & Produce ${selectedOrderDetail.quantityPlanned} Units`
                        : 'Cannot Assemble (Shortages)'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {selectedOrderDetail.status === 'COMPLETED' && (
              <div
                className="p-3.5 rounded-lg border flex items-center justify-between text-xs"
                style={{
                  borderColor: 'rgba(52, 211, 153, 0.3)',
                  background: 'rgba(52, 211, 153, 0.05)',
                }}
              >
                <div>
                  <div className="font-semibold text-emerald-400">Assembly Successfully Completed</div>
                  <div style={{ color: 'var(--c-text-3)' }}>
                    Finished goods incremented into stock. Components deducted with audit ledger tracking.
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div className="font-bold text-pleros-white">
                    Cost: ${(selectedOrderDetail.unitCost ?? 0).toFixed(2)} / unit
                  </div>
                  <div style={{ color: 'var(--c-text-3)' }}>
                    Total: ${(selectedOrderDetail.totalCost ?? 0).toFixed(2)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </PlerosDialogModal>

      {/* ------------------------------------------------------------------ */}
      {/* MODAL: Dekit / Disassemble                                          */}
      {/* ------------------------------------------------------------------ */}
      <PlerosDialogModal
        open={disassembleOpen}
        onOpenChange={setDisassembleOpen}
        title="Dekit / Disassemble Finished Goods"
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
            Disassemble completed kits back into raw component inventory. This decrements finished good stock and restores all component parts according to the BOM recipe.
          </p>

          <div>
            <label className="text-xs font-semibold block mb-1 text-pleros-white">
              BOM Recipe *
            </label>
            <select
              className="pleros-input text-xs w-full"
              value={disassembleBomId}
              onChange={(e) => {
                setDisassembleBomId(e.target.value)
                const found = boms.find((b) => b.id === e.target.value)
                if (found) setDisassembleSkuId(found.skuId)
              }}
            >
              <option value="">Select BOM recipe…</option>
              {boms.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bomNumber} · {b.name} ({b.finishedGood?.name})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold block mb-1 text-pleros-white">
              Warehouse *
            </label>
            <select
              className="pleros-input text-xs w-full"
              value={disassembleWarehouseId}
              onChange={(e) => setDisassembleWarehouseId(e.target.value)}
            >
              <option value="">Select warehouse location…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold block mb-1 text-pleros-white">
              Quantity of Finished Goods to Disassemble *
            </label>
            <input
              type="number"
              min="1"
              step="1"
              className="pleros-input text-xs w-full"
              value={disassembleQty}
              onChange={(e) => setDisassembleQty(e.target.value)}
            />
          </div>

          {disassembleMutation.isError && (
            <div className="text-xs text-rose-400 p-2 rounded bg-rose-500/10 border border-rose-500/20">
              {(disassembleMutation.error as Error)?.message || 'Failed to disassemble kit'}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--c-border-card)' }}>
            <button
              type="button"
              className="btn-ghost !py-2 !px-4 !text-xs font-medium rounded-lg"
              onClick={() => setDisassembleOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary !py-2 !px-4 !text-xs font-semibold rounded-lg shadow-sm"
              disabled={
                !disassembleBomId ||
                !disassembleWarehouseId ||
                parseInt(disassembleQty) < 1 ||
                disassembleMutation.isPending
              }
              onClick={() => {
                disassembleMutation.mutate({
                  skuId: disassembleSkuId,
                  bomId: disassembleBomId,
                  warehouseId: disassembleWarehouseId,
                  quantity: parseInt(disassembleQty, 10),
                })
              }}
            >
              {disassembleMutation.isPending ? 'Disassembling…' : 'Execute Dekitting'}
            </button>
          </div>
        </div>
      </PlerosDialogModal>
    </div>
  )
}
