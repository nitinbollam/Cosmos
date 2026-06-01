import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/cosmos/empty-state'

type Register = { id: string; name: string; warehouseId: string | null }
type Customer = { id: string; name: string; email?: string | null }
type Sku = { id: string; code: string; name: string; price: string | number; quantityAvailable?: number }
type SkuList = { items: Sku[]; total: number }
type Warehouse = { id: string; name: string; code: string; isDefault?: boolean }

type CartLine = { skuId: string; code: string; name: string; quantity: number; unitPrice: number }

function toPrice(n: string | number): number {
  if (typeof n === 'number') return n
  const x = Number.parseFloat(String(n))
  return Number.isFinite(x) ? x : 0
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

export default function PosPage() {
  const qc = useQueryClient()
  const [registerId, setRegisterId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'CHECK'>('CASH')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [lastOrderId, setLastOrderId] = useState<string | null>(null)
  const [lastOrderTotal, setLastOrderTotal] = useState<number | null>(null)
  const [submitErr, setSubmitErr] = useState<string | null>(null)

  async function printReceipt(orderId: string) {
    const token = window.localStorage.getItem('cosmos.accessToken')
    const res = await fetch(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/receipt`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error('Could not load receipt')
    const html = await res.text()
    const w = window.open('', '_blank', 'width=360,height=640')
    if (!w) throw new Error('Allow pop-ups to print receipts')
    w.document.write(html)
    w.document.close()
    w.onload = () => w.print()
  }

  const registersQ = useQuery({
    queryKey: ['pos-registers'],
    queryFn: () => api.get<Register[]>('/pos/registers'),
  })

  const customersQ = useQuery({
    queryKey: ['pos-customers'],
    queryFn: () => api.get<Customer[]>('/customers'),
  })

  const warehousesQ = useQuery({
    queryKey: ['pos-warehouses'],
    queryFn: () => api.get<Warehouse[]>('/warehouses'),
  })

  const skusQ = useQuery({
    queryKey: ['pos-skus', search],
    queryFn: () => {
      const params = new URLSearchParams({ page: '1', pageSize: '12', inStock: 'true' })
      if (search.trim()) params.set('search', search.trim())
      return api.get<SkuList>(`/skus?${params.toString()}`)
    },
  })

  const createRegister = useMutation({
    mutationFn: (name: string) => api.post<Register>('/pos/registers', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-registers'] }),
  })

  const selectedRegister = registersQ.data?.find((r) => r.id === registerId)
  const warehouseId =
    selectedRegister?.warehouseId ??
    warehousesQ.data?.find((w) => w.isDefault)?.id ??
    warehousesQ.data?.[0]?.id ??
    ''

  const walkInCustomerId = useMemo(
    () => customersQ.data?.find((c) => c.email === 'walkin@cosmos.local')?.id ?? customersQ.data?.[0]?.id ?? '',
    [customersQ.data],
  )

  const effectiveCustomerId = customerId || walkInCustomerId

  const subtotal = cart.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const tax = +(subtotal * 0.0825).toFixed(2)
  const total = +(subtotal + tax).toFixed(2)

  const checkout = useMutation({
    mutationFn: () =>
      api.post<{ id: string; orderNumber?: string; totalAmount: number }>('/pos/orders', {
        registerId,
        customerId: effectiveCustomerId,
        paymentMethod,
        lineItems: cart.map((l) => ({
          skuId: l.skuId,
          warehouseId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      }),
    onSuccess: (order) => {
      setLastOrderId(order.id)
      setLastOrderTotal(order.totalAmount)
      setCart([])
      setSubmitErr(null)
    },
    onError: (e) => setSubmitErr(errMsg(e)),
  })

  function addToCart(sku: Sku) {
    const unitPrice = toPrice(sku.price)
    setCart((prev) => {
      const existing = prev.find((l) => l.skuId === sku.id)
      if (existing) {
        return prev.map((l) => (l.skuId === sku.id ? { ...l, quantity: l.quantity + 1 } : l))
      }
      return [...prev, { skuId: sku.id, code: sku.code, name: sku.name, quantity: 1, unitPrice }]
    })
  }

  function updateQty(skuId: string, quantity: number) {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((l) => l.skuId !== skuId))
      return
    }
    setCart((prev) => prev.map((l) => (l.skuId === skuId ? { ...l, quantity } : l)))
  }

  const registers = registersQ.data ?? []

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-cosmos-white font-display">Point of sale</h1>
          <p className="text-sm mt-1 text-cosmos-text-3">
            Register checkout via <span className="font-mono">POST /pos/orders</span> · requires POS feature flag
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost !text-sm"
          onClick={() => createRegister.mutate(`Register ${registers.length + 1}`)}
          disabled={createRegister.isPending}
        >
          Add register
        </button>
      </div>

      {lastOrderId ? (
        <div className="cosmos-card border border-emerald-500/30">
          <p className="text-emerald-400 font-medium">Sale complete</p>
          <p className="text-sm text-cosmos-text-2 mt-1">
            Order <span className="font-mono">{lastOrderId.slice(-10)}</span>
            {lastOrderTotal != null ? ` · ${money(lastOrderTotal)}` : ''}
          </p>
          <div className="flex flex-wrap gap-3 mt-3">
            <button type="button" className="btn-primary !text-sm" onClick={() => void printReceipt(lastOrderId)}>
              Print receipt
            </button>
            <Link to={`/admin/orders/${encodeURIComponent(lastOrderId)}`} className="cosmos-shop-link-accent text-sm">
              View order →
            </Link>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-4">
          <div className="cosmos-card grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs text-cosmos-text-3">Register</label>
              <select
                className="cosmos-input mt-1"
                value={registerId}
                onChange={(e) => setRegisterId(e.target.value)}
              >
                <option value="">Select register…</option>
                {registers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-cosmos-text-3">Customer</label>
              <select
                className="cosmos-input mt-1"
                value={effectiveCustomerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                {(customersQ.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="cosmos-card">
            <label className="text-xs text-cosmos-text-3">Add products</label>
            <input
              className="cosmos-input mt-1 mb-4"
              placeholder="Search SKU name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {skusQ.isLoading ? (
              <div className="skeleton h-24 w-full" />
            ) : (skusQ.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-cosmos-text-3">No in-stock SKUs match your search.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {(skusQ.data?.items ?? []).map((sku) => (
                  <button
                    key={sku.id}
                    type="button"
                    className="text-left rounded-xl border p-3 transition-colors hover:border-cosmos-accent/50"
                    style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
                    onClick={() => addToCart(sku)}
                  >
                    <p className="font-mono text-xs text-cosmos-accent">{sku.code}</p>
                    <p className="text-sm text-cosmos-white font-medium mt-1">{sku.name}</p>
                    <p className="text-xs text-cosmos-text-3 mt-1">
                      {money(toPrice(sku.price))} · {sku.quantityAvailable ?? 0} avail
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="cosmos-card sticky top-4 space-y-4">
            <h2 className="text-cosmos-white font-semibold font-display">Cart</h2>
            {cart.length === 0 ? (
              <EmptyState icon="🛒" title="Cart is empty" description="Tap a product to add it to the sale." />
            ) : (
              <ul className="space-y-3">
                {cart.map((line) => (
                  <li key={line.skuId} className="flex gap-3 items-start border-b pb-3" style={{ borderColor: 'var(--c-border)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-cosmos-white truncate">{line.name}</p>
                      <p className="font-mono text-xs text-cosmos-text-3">{line.code}</p>
                      <p className="text-xs text-cosmos-text-3 mt-1">{money(line.unitPrice)} each</p>
                    </div>
                    <input
                      className="cosmos-input w-16 !py-1 text-center"
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => updateQty(line.skuId, Number(e.target.value))}
                    />
                    <p className="text-sm text-cosmos-white w-16 text-right">{money(line.quantity * line.unitPrice)}</p>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-1 text-sm border-t pt-3" style={{ borderColor: 'var(--c-border)' }}>
              <div className="flex justify-between text-cosmos-text-2">
                <span>Subtotal</span>
                <span>{money(subtotal)}</span>
              </div>
              <div className="flex justify-between text-cosmos-text-2">
                <span>Tax (est.)</span>
                <span>{money(tax)}</span>
              </div>
              <div className="flex justify-between text-cosmos-white font-semibold text-base pt-1">
                <span>Total</span>
                <span>{money(total)}</span>
              </div>
            </div>

            <div>
              <label className="text-xs text-cosmos-text-3">Payment method</label>
              <select
                className="cosmos-input mt-1"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as 'CASH' | 'CARD' | 'CHECK')}
              >
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="CHECK">Check</option>
              </select>
            </div>

            {submitErr ? <p className="text-sm text-red-400">{submitErr}</p> : null}

            <button
              type="button"
              className="btn-primary w-full"
              disabled={
                !registerId ||
                !warehouseId ||
                !effectiveCustomerId ||
                cart.length === 0 ||
                checkout.isPending
              }
              onClick={() => checkout.mutate()}
            >
              {checkout.isPending ? 'Processing…' : `Complete sale · ${money(total)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
