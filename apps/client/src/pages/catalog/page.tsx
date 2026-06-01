import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { useCartStore } from '@/stores/cart.store'

type Sku = {
  id: string
  code: string
  name: string
  description?: string | null
  price: string | number
  listPrice?: string | number
  contractPrice?: string | number
  priceSource?: 'list' | 'contract'
  category?: string
  unitOfMeasure?: string | null
  quantityAvailable?: number
  createdAt?: string
}

type SkuList = { items: Sku[]; total: number; page: number; pageSize: number; hasMore: boolean }

type Warehouse = { id: string; name: string; code?: string }

function toPrice(n: string | number): number {
  if (typeof n === 'number') return n
  const x = Number.parseFloat(String(n))
  return Number.isFinite(x) ? x : 0
}

export default function CatalogPage() {
  const addItem = useCartStore((s) => s.addItem)
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [category, setCategory] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [sort, setSort] = useState<'name' | 'price-asc' | 'price-desc' | 'newest'>('name')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<Sku[]>([])
  const [meta, setMeta] = useState<{ total: number; hasMore: boolean; pageSize: number } | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [qtyBySku, setQtyBySku] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    void (async () => {
      try {
        const [cat, wh] = await Promise.all([api.get<string[]>('/skus/categories'), api.get<Warehouse[]>('/warehouses')])
        setCategories(cat)
        setWarehouses(wh)
        setWarehouseId((prev) => prev || wh[0]?.id || '')
      } catch {
        /* non-fatal */
      }
    })()
  }, [])

  const fetchPage = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', '48')
      if (debounced) params.set('search', debounced)
      if (category) params.set('category', category)
      if (warehouseId) params.set('warehouseId', warehouseId)
      if (inStockOnly) params.set('inStock', 'true')
      const res = await api.get<SkuList>(`/skus?${params.toString()}`)
      setItems(res.items)
      setMeta({ total: res.total, hasMore: res.hasMore, pageSize: res.pageSize })
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not load catalog')
      setItems([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [page, debounced, category, warehouseId, inStockOnly])

  useEffect(() => {
    void fetchPage()
  }, [fetchPage])

  const sorted = useMemo(() => {
    const rows = [...items]
    const min = priceMin ? Number(priceMin) : null
    const max = priceMax ? Number(priceMax) : null
    let f = rows
    if (min !== null && Number.isFinite(min)) f = f.filter((s) => toPrice(s.price) >= min)
    if (max !== null && Number.isFinite(max)) f = f.filter((s) => toPrice(s.price) <= max)
    if (sort === 'name') f.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'price-asc') f.sort((a, b) => toPrice(a.price) - toPrice(b.price))
    if (sort === 'price-desc') f.sort((a, b) => toPrice(b.price) - toPrice(a.price))
    if (sort === 'newest')
      f.sort((a, b) => (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0))
    return f
  }, [items, sort, priceMin, priceMax])

  const defaultWh = warehouseId || warehouses[0]?.id || ''

  function onAdd(sku: Sku) {
    if (!defaultWh) {
      setToast('Select a warehouse for stocking')
      window.setTimeout(() => setToast(null), 2500)
      return
    }
    const raw = qtyBySku[sku.id] ?? '1'
    const qty = Math.max(1, Number.parseInt(raw, 10) || 1)
    const avail = sku.quantityAvailable ?? 0
    if (avail > 0 && qty > avail) {
      setToast(`Only ${avail} available`)
      window.setTimeout(() => setToast(null), 2500)
      return
    }
    addItem({
      skuId: sku.id,
      skuName: sku.name,
      skuCode: sku.code,
      unitPrice: toPrice(sku.price),
      quantity: qty,
      warehouseId: defaultWh,
    })
    setToast(`Added ${sku.code}`)
    window.setTimeout(() => setToast(null), 2000)
  }

  const start = meta ? (page - 1) * meta.pageSize + 1 : 0
  const end = meta ? Math.min(page * meta.pageSize, meta.total) : 0

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 64px)', color: 'var(--c-text)' }}>
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          borderRight: '1px solid var(--c-border)',
          padding: 20,
          background: 'var(--c-surface)',
        }}
      >
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--c-heading)', margin: '0 0 16px' }}>Filters</h2>
        <label style={{ fontSize: 12, color: 'var(--c-text-3)', display: 'block', marginBottom: 8 }}>Category</label>
        <select
          className="cosmos-input"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value)
            setPage(1)
          }}
          style={{ marginBottom: 16 }}
        >
          <option value="">All</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 12, color: 'var(--c-text-3)', display: 'block', marginBottom: 8 }}>Warehouse</label>
        <select
          className="cosmos-input"
          value={warehouseId}
          onChange={(e) => {
            setWarehouseId(e.target.value)
            setPage(1)
          }}
          style={{ marginBottom: 16 }}
        >
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 12, color: 'var(--c-text-3)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <input type="checkbox" checked={inStockOnly} onChange={(e) => { setInStockOnly(e.target.checked); setPage(1) }} />
          In stock only
        </label>
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>Price range</span>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input className="cosmos-input" placeholder="Min" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} />
            <input className="cosmos-input" placeholder="Max" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} />
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost w-full"
          onClick={() => {
            setCategory('')
            setInStockOnly(false)
            setPriceMin('')
            setPriceMax('')
            setQ('')
            setPage(1)
          }}
        >
          Clear filters
        </button>
      </aside>
      <div style={{ flex: 1, padding: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 20 }}>
          <input
            className="cosmos-input"
            style={{ flex: 1, minWidth: 200, maxWidth: 400 }}
            placeholder="Search…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
          <select className="cosmos-input" style={{ width: 200 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="name">Name A–Z</option>
            <option value="price-asc">Price ↑</option>
            <option value="price-desc">Price ↓</option>
            <option value="newest">Newest</option>
          </select>
        </div>
        {meta && !loading ? (
          <p style={{ fontSize: 13, color: 'var(--c-text-3)', marginBottom: 16 }}>
            Showing {start}-{end} of {meta.total} products
          </p>
        ) : null}
        {err ? <p style={{ color: 'var(--c-danger)' }}>{err}</p> : null}
        {toast ? <p style={{ color: 'var(--c-success)', marginBottom: 12 }}>{toast}</p> : null}
        {loading && items.length === 0 ? <div className="skeleton" style={{ height: 160, width: '100%' }} /> : null}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 16,
          }}
        >
          {sorted.map((sku) => {
            const oos = (sku.quantityAvailable ?? 0) === 0
            return (
              <div key={sku.id} className="cosmos-card relative" style={{ padding: 16 }}>
                {oos ? (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(6,6,15,0.75)',
                      borderRadius: 14,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      color: 'var(--c-text-3)',
                    }}
                  >
                    Out of stock
                  </div>
                ) : null}
                <div
                  style={{
                    height: 160,
                    background: 'var(--c-surface-2)',
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--c-text-3)',
                    marginBottom: 12,
                  }}
                >
                  {sku.code}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-3)' }}>{sku.code}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 15, marginTop: 4 }}>{sku.name}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--c-accent)', marginTop: 8 }}>
                  ${toPrice(sku.price).toFixed(2)}
                  {sku.priceSource === 'contract' && sku.listPrice != null ? (
                    <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--c-text-3)', marginLeft: 6, textDecoration: 'line-through' }}>
                      ${toPrice(sku.listPrice).toFixed(2)}
                    </span>
                  ) : null}
                </div>
                {sku.priceSource === 'contract' ? (
                  <div style={{ fontSize: 11, color: 'var(--c-success)', marginTop: 4 }}>Contract price</div>
                ) : null}
                <input
                  type="number"
                  min={1}
                  className="cosmos-input mt-3"
                  value={qtyBySku[sku.id] ?? '1'}
                  onChange={(e) => setQtyBySku((prev) => ({ ...prev, [sku.id]: e.target.value }))}
                />
                <button type="button" className="btn-primary w-full mt-2" disabled={oos} onClick={() => onAdd(sku)} style={{ width: '100%' }}>
                  Add to Cart
                </button>
              </div>
            )
          })}
        </div>
        {!loading && sorted.length === 0 ? (
          <p style={{ color: 'var(--c-text-3)', marginTop: 24 }}>No SKUs match. Adjust filters or seed inventory.</p>
        ) : null}
        {meta?.hasMore ? (
          <div style={{ marginTop: 24 }}>
            <button type="button" className="btn-ghost" disabled={loading} onClick={() => setPage((p) => p + 1)}>
              Next page
            </button>
          </div>
        ) : null}
        {page > 1 ? (
          <button type="button" className="btn-ghost mt-2" onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous page
          </button>
        ) : null}
      </div>
    </div>
  )
}
