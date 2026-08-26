import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'

type Register = { id: string; name: string; warehouseId: string | null }
type Customer = { id: string; name: string; email?: string | null; isLicensedTobacco?: boolean }
type Sku = {
  id: string
  code: string
  name: string
  price: string | number
  quantityAvailable?: number
  isTobacco?: boolean
  ageRestricted?: boolean
  minimumAge?: number | null
}
type SkuList = { items: Sku[]; total: number }
type Warehouse = { id: string; name: string; code: string; isDefault?: boolean }

type CartLine = {
  skuId: string
  code: string
  name: string
  quantity: number
  unitPrice: number
  ageRestricted?: boolean
  minimumAge?: number | null
}

type AgeAttestationMethod = 'ID_CHECK' | 'DOB_ENTRY' | 'LICENSE_ON_FILE'

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
  const [ageMethod, setAgeMethod] = useState<AgeAttestationMethod>('ID_CHECK')
  const [dob, setDob] = useState('')
  const [ageNotes, setAgeNotes] = useState('')

  const policyQ = useQuery({
    queryKey: ['age-verification-policy'],
    queryFn: () =>
      api.get<{
        enabled: boolean
        minimumAge: number
        requirePosAttestation: boolean
      }>('/compliance/age-verification'),
  })

  async function printReceipt(orderId: string) {
    const token = window.localStorage.getItem('pleros.accessToken')
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
    () => customersQ.data?.find((c) => c.email === 'walkin@pleros.local')?.id ?? customersQ.data?.[0]?.id ?? '',
    [customersQ.data],
  )

  const effectiveCustomerId = customerId || walkInCustomerId
  const selectedCustomer = (customersQ.data ?? []).find((c) => c.id === effectiveCustomerId)

  const cartNeedsAge =
    Boolean(policyQ.data?.enabled) &&
    Boolean(policyQ.data?.requirePosAttestation) &&
    cart.some((l) => l.ageRestricted)

  const requiredMinAge = Math.max(
    policyQ.data?.minimumAge ?? 21,
    ...cart.filter((l) => l.ageRestricted).map((l) => l.minimumAge ?? policyQ.data?.minimumAge ?? 21),
  )

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
        ...(cartNeedsAge
          ? {
              ageAttestation: {
                method: ageMethod,
                dateOfBirth: ageMethod === 'DOB_ENTRY' ? dob : undefined,
                notes: ageNotes.trim() || undefined,
              },
            }
          : {}),
      }),
    onSuccess: (order) => {
      setLastOrderId(order.id)
      setLastOrderTotal(order.totalAmount)
      setCart([])
      setSubmitErr(null)
      setDob('')
      setAgeNotes('')
    },
    onError: (e) => setSubmitErr(errMsg(e)),
  })

  function addToCart(sku: Sku) {
    const unitPrice = toPrice(sku.price)
    const ageRestricted = Boolean(sku.ageRestricted || sku.isTobacco)
    setCart((prev) => {
      const existing = prev.find((l) => l.skuId === sku.id)
      if (existing) {
        return prev.map((l) => (l.skuId === sku.id ? { ...l, quantity: l.quantity + 1 } : l))
      }
      return [
        ...prev,
        {
          skuId: sku.id,
          code: sku.code,
          name: sku.name,
          quantity: 1,
          unitPrice,
          ageRestricted,
          minimumAge: sku.minimumAge ?? (ageRestricted ? 21 : null),
        },
      ]
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
    <div className="pos-page p-6 space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pleros-white font-display">Point of sale</h1>
          <p className="text-sm mt-1 text-pleros-text-3">Walk-in checkout at a register. Age checks apply to restricted SKUs.</p>
        </div>
        <button
          type="button"
          className="btn-ghost !text-sm shrink-0"
          onClick={() => createRegister.mutate(`Register ${registers.length + 1}`)}
          disabled={createRegister.isPending}
        >
          Add register
        </button>
      </div>

      {lastOrderId ? (
        <div className="pleros-card border border-emerald-500/30">
          <p className="text-emerald-400 font-medium">Sale complete</p>
          <p className="text-sm text-pleros-text-2 mt-1">
            Order <span className="font-mono">{lastOrderId.slice(-10)}</span>
            {lastOrderTotal != null ? ` · ${money(lastOrderTotal)}` : ''}
          </p>
          <div className="flex flex-wrap gap-3 mt-3">
            <button type="button" className="btn-primary !text-sm" onClick={() => void printReceipt(lastOrderId)}>
              Print receipt
            </button>
            <Link to={`/admin/orders/${encodeURIComponent(lastOrderId)}`} className="pleros-shop-link-accent text-sm">
              View order →
            </Link>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5 items-start">
        <div className="lg:col-span-3 space-y-4 min-w-0">
          <div className="pleros-card grid gap-4 grid-cols-1 sm:grid-cols-2">
            <div className="min-w-0">
              <label className="text-xs text-pleros-text-3 block">Register</label>
              <select
                className="pleros-input mt-1 w-full"
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
            <div className="min-w-0">
              <label className="text-xs text-pleros-text-3 block">Customer</label>
              <select
                className="pleros-input mt-1 w-full"
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

          <div className="pleros-card">
            <label className="text-xs text-pleros-text-3 block">Add products</label>
            <input
              className="pleros-input mt-1 mb-4 w-full"
              placeholder="Search SKU name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {skusQ.isLoading ? (
              <div className="skeleton h-24 w-full" />
            ) : (skusQ.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-pleros-text-3">No in-stock SKUs match your search.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {(skusQ.data?.items ?? []).map((sku) => {
                  const restricted = Boolean(sku.ageRestricted || sku.isTobacco)
                  const minAge = sku.minimumAge ?? (restricted ? 21 : null)
                  return (
                    <button
                      key={sku.id}
                      type="button"
                      className="text-left rounded-xl border p-3 min-h-[88px] flex flex-col transition-colors hover:border-pleros-accent/50"
                      style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
                      onClick={() => addToCart(sku)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-mono text-xs text-pleros-accent truncate">{sku.code}</p>
                        {restricted ? (
                          <span
                            className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--c-warning)', color: 'var(--c-bg)' }}
                          >
                            {minAge}+
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-pleros-white font-medium mt-1 line-clamp-2">{sku.name}</p>
                      <p className="text-xs text-pleros-text-3 mt-auto pt-2">
                        {money(toPrice(sku.price))} · {sku.quantityAvailable ?? 0} avail
                      </p>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 min-w-0">
          <div className="pleros-card sticky top-4 space-y-4">
            <h2 className="text-pleros-white font-semibold font-display">Cart</h2>
            {cart.length === 0 ? (
              <EmptyState icon="🛒" title="Cart is empty" description="Tap a product to add it to the sale." />
            ) : (
              <ul className="space-y-0">
                {cart.map((line) => (
                  <li
                    key={line.skuId}
                    className="grid grid-cols-[minmax(0,1fr)_3.25rem_4.5rem] gap-x-3 gap-y-1 items-center border-b py-3"
                    style={{ borderColor: 'var(--c-border)' }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-pleros-white truncate leading-snug">{line.name}</p>
                      <p className="font-mono text-xs text-pleros-text-3 mt-0.5 truncate">{line.code}</p>
                    </div>
                    <input
                      className="pleros-input !w-full !min-w-0 !max-w-[3.25rem] !py-1.5 !px-1 text-center tabular-nums"
                      type="number"
                      min={1}
                      aria-label={`Quantity for ${line.name}`}
                      value={line.quantity}
                      onChange={(e) => updateQty(line.skuId, Number(e.target.value))}
                    />
                    <p className="text-sm text-pleros-white text-right tabular-nums font-medium">
                      {money(line.quantity * line.unitPrice)}
                    </p>
                    <p className="text-xs text-pleros-text-3 col-span-3">
                      {money(line.unitPrice)} each
                      {line.ageRestricted ? ` · ${line.minimumAge ?? requiredMinAge}+` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-1.5 text-sm border-t pt-3" style={{ borderColor: 'var(--c-border)' }}>
              <div className="flex justify-between gap-4 text-pleros-text-2">
                <span>Subtotal</span>
                <span className="tabular-nums shrink-0">{money(subtotal)}</span>
              </div>
              <div className="flex justify-between gap-4 text-pleros-text-2">
                <span>Tax (est.)</span>
                <span className="tabular-nums shrink-0">{money(tax)}</span>
              </div>
              <div className="flex justify-between gap-4 text-pleros-white font-semibold text-base pt-1">
                <span>Total</span>
                <span className="tabular-nums shrink-0">{money(total)}</span>
              </div>
            </div>

            <div>
              <label className="text-xs text-pleros-text-3 block">Payment method</label>
              <select
                className="pleros-input mt-1 w-full"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as 'CASH' | 'CARD' | 'CHECK')}
              >
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="CHECK">Check</option>
              </select>
            </div>

            {cartNeedsAge ? (
              <div
                className="rounded-lg p-3 space-y-3"
                style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}
              >
                <div>
                  <p className="text-sm font-medium text-pleros-white">Age verification (min {requiredMinAge})</p>
                  <p className="text-xs text-pleros-text-3 mt-1 leading-relaxed">
                    Cart includes age-restricted items. Confirm customer ID before completing the sale.
                  </p>
                </div>
                <div>
                  <label className="text-xs text-pleros-text-3 block">Verification method</label>
                  <select
                    className="pleros-input mt-1 w-full"
                    value={ageMethod}
                    onChange={(e) => setAgeMethod(e.target.value as AgeAttestationMethod)}
                  >
                    <option value="ID_CHECK">Government ID checked</option>
                    <option value="DOB_ENTRY">Enter date of birth</option>
                    <option value="LICENSE_ON_FILE" disabled={!selectedCustomer?.isLicensedTobacco}>
                      License on file{selectedCustomer?.isLicensedTobacco ? '' : ' (unavailable)'}
                    </option>
                  </select>
                </div>
                {ageMethod === 'DOB_ENTRY' ? (
                  <div>
                    <label className="text-xs text-pleros-text-3 block">Date of birth</label>
                    <input
                      className="pleros-input mt-1 w-full"
                      type="date"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      required
                    />
                  </div>
                ) : null}
                <div>
                  <label className="text-xs text-pleros-text-3 block">Notes (optional)</label>
                  <input
                    className="pleros-input mt-1 w-full"
                    placeholder="ID type, last 4…"
                    value={ageNotes}
                    onChange={(e) => setAgeNotes(e.target.value)}
                  />
                </div>
              </div>
            ) : null}

            {submitErr ? <p className="text-sm text-red-400">{submitErr}</p> : null}

            <button
              type="button"
              className="btn-primary w-full"
              disabled={
                !registerId ||
                !warehouseId ||
                !effectiveCustomerId ||
                cart.length === 0 ||
                checkout.isPending ||
                (cartNeedsAge && ageMethod === 'DOB_ENTRY' && !dob)
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
