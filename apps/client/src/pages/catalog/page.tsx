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

type Warehouse = {
  id: string
  name: string
  code?: string
  isDefault?: boolean
  totalAvailable?: number
  inStockSkuCount?: number
}

function pickBestWarehouse(list: Warehouse[]): string {
  if (list.length === 0) return ''
  const defWithStock = list.find((w) => w.isDefault && (w.totalAvailable ?? 0) > 0)
  if (defWithStock) return defWithStock.id
  const stocked = [...list].filter((w) => (w.totalAvailable ?? 0) > 0)
  if (stocked.length > 0) {
    stocked.sort((a, b) => (b.totalAvailable ?? 0) - (a.totalAvailable ?? 0))
    return stocked[0]!.id
  }
  const def = list.find((w) => w.isDefault)
  if (def) return def.id
  return list[0]?.id || ''
}

function toPrice(n: string | number): number {
  if (typeof n === 'number') return n
  const x = Number.parseFloat(String(n))
  return Number.isFinite(x) ? x : 0
}

function getCategoryTheme(category?: string, name?: string, code?: string) {
  const text = `${category || ''} ${name || ''} ${code || ''}`.toLowerCase()
  if (text.includes('bev') || text.includes('drink') || text.includes('energy') || text.includes('soda') || text.includes('water')) {
    return {
      icon: '🥤',
      label: category || 'Beverages',
      bgGradient: 'radial-gradient(circle at 50% 35%, rgba(56, 189, 248, 0.22) 0%, rgba(15, 23, 42, 0.7) 100%)',
      accentColor: '#38bdf8',
      badgeBg: 'rgba(56, 189, 248, 0.12)',
      badgeBorder: 'rgba(56, 189, 248, 0.25)',
    }
  }
  if (text.includes('vap') || text.includes('nic') || text.includes('pod') || text.includes('mod') || text.includes('smoke')) {
    return {
      icon: '💨',
      label: category || 'Vapor & Pods',
      bgGradient: 'radial-gradient(circle at 50% 35%, rgba(168, 85, 247, 0.22) 0%, rgba(15, 23, 42, 0.7) 100%)',
      accentColor: '#c084fc',
      badgeBg: 'rgba(168, 85, 247, 0.12)',
      badgeBorder: 'rgba(168, 85, 247, 0.25)',
    }
  }
  if (text.includes('snack') || text.includes('chip') || text.includes('food') || text.includes('candy') || text.includes('choc')) {
    return {
      icon: '🍫',
      label: category || 'Snacks & Confections',
      bgGradient: 'radial-gradient(circle at 50% 35%, rgba(245, 158, 11, 0.22) 0%, rgba(15, 23, 42, 0.7) 100%)',
      accentColor: '#fbbf24',
      badgeBg: 'rgba(245, 158, 11, 0.12)',
      badgeBorder: 'rgba(245, 158, 11, 0.25)',
    }
  }
  if (text.includes('acc') || text.includes('cable') || text.includes('charg') || text.includes('usb') || text.includes('elect')) {
    return {
      icon: '🔌',
      label: category || 'Accessories',
      bgGradient: 'radial-gradient(circle at 50% 35%, rgba(16, 185, 129, 0.22) 0%, rgba(15, 23, 42, 0.7) 100%)',
      accentColor: '#34d399',
      badgeBg: 'rgba(16, 185, 129, 0.12)',
      badgeBorder: 'rgba(16, 185, 129, 0.25)',
    }
  }
  if (text.includes('stand') || text.includes('display') || text.includes('rack') || text.includes('fixture')) {
    return {
      icon: '📦',
      label: category || 'Displays & Merch',
      bgGradient: 'radial-gradient(circle at 50% 35%, rgba(99, 102, 241, 0.22) 0%, rgba(15, 23, 42, 0.7) 100%)',
      accentColor: '#818cf8',
      badgeBg: 'rgba(99, 102, 241, 0.12)',
      badgeBorder: 'rgba(99, 102, 241, 0.25)',
    }
  }
  return {
    icon: '🏷️',
    label: category || 'General Wholesale',
    bgGradient: 'radial-gradient(circle at 50% 35%, rgba(148, 163, 184, 0.18) 0%, rgba(15, 23, 42, 0.7) 100%)',
    accentColor: '#94a3b8',
    badgeBg: 'rgba(148, 163, 184, 0.12)',
    badgeBorder: 'rgba(148, 163, 184, 0.25)',
  }
}

export default function CatalogPage() {
  const addItem = useCartStore((s) => s.addItem)
  const cartCount = useCartStore((s) => s.count())
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
  const [qtyBySku, setQtyBySku] = useState<Record<string, number>>({})
  const [recentlyAddedSkuId, setRecentlyAddedSkuId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; skuCode?: string } | null>(null)

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
        setWarehouseId((prev) => prev || pickBestWarehouse(wh))
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

  const defaultWh = warehouseId || pickBestWarehouse(warehouses)
  const currentWhObj = warehouses.find((w) => w.id === defaultWh)

  function getQty(skuId: string): number {
    return qtyBySku[skuId] ?? 1
  }

  function setQty(skuId: string, val: number) {
    setQtyBySku((prev) => ({ ...prev, [skuId]: Math.max(1, val) }))
  }

  function onAdd(sku: Sku) {
    if (!defaultWh) {
      setToast({ message: 'Please select a warehouse first' })
      window.setTimeout(() => setToast(null), 3000)
      return
    }
    const qty = getQty(sku.id)
    const avail = sku.quantityAvailable ?? 0
    if (avail > 0 && qty > avail) {
      setToast({ message: `Only ${avail} available in stock` })
      window.setTimeout(() => setToast(null), 3000)
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
    setRecentlyAddedSkuId(sku.id)
    setToast({ message: `Added ${qty} × ${sku.name} to cart`, skuCode: sku.code })
    window.setTimeout(() => setRecentlyAddedSkuId(null), 1800)
    window.setTimeout(() => setToast(null), 3500)
  }

  const start = meta ? (page - 1) * meta.pageSize + 1 : 0
  const end = meta ? Math.min(page * meta.pageSize, meta.total) : 0

  return (
    <div className="min-h-[calc(100vh-64px)] flex flex-col md:flex-row bg-[var(--c-bg)] text-[var(--c-text)]">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 py-3 px-4 rounded-xl shadow-2xl border backdrop-blur-md bg-slate-900/90 text-white border-emerald-500/40 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs sm:text-sm font-medium">{toast.message}</span>
          <Link
            to="/cart"
            className="ml-2 text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors"
          >
            View Cart ({cartCount}) →
          </Link>
        </div>
      )}

      {/* Sidebar Filter Panel */}
      <aside className="w-full md:w-72 lg:w-80 flex-shrink-0 md:m-6 md:mr-0 p-5 rounded-2xl border border-[var(--c-border-card)] bg-[var(--c-surface)] shadow-sm space-y-6 self-start">
        {/* Filter Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--c-border)]">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[var(--c-primary-dim)] text-[var(--c-primary)] flex items-center justify-center text-sm font-bold shadow-inner">
              ⚡
            </span>
            <div>
              <h2 className="text-xs font-bold tracking-wider uppercase text-pleros-white font-display">Filters</h2>
              <p className="text-[10px] text-[var(--c-text-3)] font-medium">Refine catalog products</p>
            </div>
          </div>
          {(category || inStockOnly || priceMin || priceMax || q) ? (
            <button
              type="button"
              onClick={() => {
                setCategory('')
                setInStockOnly(false)
                setPriceMin('')
                setPriceMax('')
                setQ('')
                setPage(1)
              }}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-[var(--c-surface-2)] text-[var(--c-accent)] hover:bg-[var(--c-accent-soft)] border border-[var(--c-border)] transition-all"
            >
              Reset all
            </button>
          ) : (
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[var(--c-surface-2)] text-[var(--c-text-3)] border border-[var(--c-border)]">
              All
            </span>
          )}
        </div>

        {/* Warehouse Selector Card */}
        <div className="space-y-2">
          <label className="text-[11px] font-bold text-[var(--c-text-2)] flex items-center gap-1.5 uppercase tracking-wider">
            <span>🏢</span> Fulfillment Hub
          </label>
          <select
            className="pleros-input w-full text-xs font-medium"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value)
              setPage(1)
            }}
          >
            {warehouses.map((w) => {
              const stockLabel = typeof w.totalAvailable === 'number' ? ` (${w.totalAvailable} in stock)` : ''
              return (
                <option key={w.id} value={w.id}>
                  {w.name}{stockLabel}
                </option>
              )
            })}
          </select>
          {currentWhObj?.totalAvailable != null && (
            <div className="p-2.5 rounded-xl bg-[var(--c-surface-2)] border border-[var(--c-border)] flex items-center gap-2 text-[11px] text-[var(--c-text-2)]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span><strong>{currentWhObj.totalAvailable.toLocaleString()}</strong> units available across {currentWhObj.inStockSkuCount ?? 0} SKUs</span>
            </div>
          )}
        </div>

        {/* Categories */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold text-[var(--c-text-2)] flex items-center gap-1.5 uppercase tracking-wider">
              <span>📂</span> Category
            </label>
            {category && (
              <button
                type="button"
                onClick={() => {
                  setCategory('')
                  setPage(1)
                }}
                className="text-[10px] font-semibold text-[var(--c-accent)] hover:underline"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex flex-wrap md:flex-col gap-1.5">
            <button
              type="button"
              onClick={() => {
                setCategory('')
                setPage(1)
              }}
              className={`text-left text-xs px-3 py-2 rounded-xl font-semibold transition-all flex items-center justify-between ${
                !category
                  ? 'bg-[var(--c-primary)] text-white shadow-md border border-[var(--c-primary)]'
                  : 'bg-[var(--c-surface-2)] text-[var(--c-text)] hover:border-[var(--c-primary)] border border-[var(--c-border)]'
              }`}
            >
              <span className="flex items-center gap-2">
                <span>✨</span>
                <span>All Categories</span>
              </span>
              {!category && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
            </button>
            {categories.map((c) => {
              const active = category === c
              const theme = getCategoryTheme(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCategory(c)
                    setPage(1)
                  }}
                  className={`text-left text-xs px-3 py-2 rounded-xl font-semibold transition-all flex items-center justify-between ${
                    active
                      ? 'bg-[var(--c-primary)] text-white shadow-md border border-[var(--c-primary)]'
                      : 'bg-[var(--c-surface-2)] text-[var(--c-text)] hover:border-[var(--c-primary)] border border-[var(--c-border)]'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span>{theme.icon}</span>
                    <span className="truncate">{c}</span>
                  </span>
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-white flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>

        {/* Availability Toggle Pill */}
        <div className="space-y-2 pt-2 border-t border-[var(--c-border)]">
          <label className="text-[11px] font-bold text-[var(--c-text-2)] flex items-center gap-1.5 uppercase tracking-wider">
            <span>📦</span> Stock Availability
          </label>
          <div className="grid grid-cols-2 p-1 rounded-xl bg-[var(--c-surface-2)] border border-[var(--c-border)] gap-1">
            <button
              type="button"
              onClick={() => {
                setInStockOnly(false)
                setPage(1)
              }}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all text-center ${
                !inStockOnly
                  ? 'bg-[var(--c-surface)] text-[var(--c-heading)] shadow-sm border border-[var(--c-border-card)]'
                  : 'text-[var(--c-text-3)] hover:text-[var(--c-text)]'
              }`}
            >
              All Items
            </button>
            <button
              type="button"
              onClick={() => {
                setInStockOnly(true)
                setPage(1)
              }}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all text-center ${
                inStockOnly
                  ? 'bg-[var(--c-primary)] text-white shadow-sm border border-[var(--c-primary)]'
                  : 'text-[var(--c-text-3)] hover:text-[var(--c-text)]'
              }`}
            >
              ⚡ In Stock
            </button>
          </div>
        </div>

        {/* Price Range */}
        <div className="space-y-2 pt-2 border-t border-[var(--c-border)]">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold text-[var(--c-text-2)] flex items-center gap-1.5 uppercase tracking-wider">
              <span>💰</span> Price Range
            </label>
            {(priceMin || priceMax) && (
              <button
                type="button"
                onClick={() => {
                  setPriceMin('')
                  setPriceMax('')
                }}
                className="text-[10px] font-semibold text-[var(--c-accent)] hover:underline"
              >
                Clear
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs font-bold text-[var(--c-text-3)]">$</span>
              <input
                type="number"
                min={0}
                placeholder="Min"
                value={priceMin}
                onChange={(e) => setPriceMin(e.target.value)}
                className="pleros-input w-full !pl-7 text-xs font-medium"
              />
            </div>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs font-bold text-[var(--c-text-3)]">$</span>
              <input
                type="number"
                min={0}
                placeholder="Max"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value)}
                className="pleros-input w-full !pl-7 text-xs font-medium"
              />
            </div>
          </div>

          {/* Quick Price Presets */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => {
                setPriceMin('0')
                setPriceMax('25')
              }}
              className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition-all ${
                priceMin === '0' && priceMax === '25'
                  ? 'bg-[var(--c-primary-dim)] text-[var(--c-primary)] border-[var(--c-primary)]'
                  : 'bg-[var(--c-surface-2)] text-[var(--c-text-2)] border-[var(--c-border)] hover:text-[var(--c-text)]'
              }`}
            >
              &lt; $25
            </button>
            <button
              type="button"
              onClick={() => {
                setPriceMin('0')
                setPriceMax('50')
              }}
              className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition-all ${
                priceMin === '0' && priceMax === '50'
                  ? 'bg-[var(--c-primary-dim)] text-[var(--c-primary)] border-[var(--c-primary)]'
                  : 'bg-[var(--c-surface-2)] text-[var(--c-text-2)] border-[var(--c-border)] hover:text-[var(--c-text)]'
              }`}
            >
              &lt; $50
            </button>
            <button
              type="button"
              onClick={() => {
                setPriceMin('50')
                setPriceMax('')
              }}
              className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition-all ${
                priceMin === '50' && priceMax === ''
                  ? 'bg-[var(--c-primary-dim)] text-[var(--c-primary)] border-[var(--c-primary)]'
                  : 'bg-[var(--c-surface-2)] text-[var(--c-text-2)] border-[var(--c-border)] hover:text-[var(--c-text)]'
              }`}
            >
              $50+
            </button>
          </div>
        </div>
      </aside>

      {/* Main Catalog View */}
      <div className="flex-1 p-5 md:p-8 flex flex-col">
        {/* Search & Sort Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <svg
              className="absolute left-3 top-3 w-4 h-4 text-[var(--c-text-3)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              className="pleros-input w-full !pl-9 !pr-8 text-xs sm:text-sm"
              placeholder="Search products by SKU, name, or category…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                className="absolute right-2.5 top-2.5 text-xs text-[var(--c-text-3)] hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--c-text-3)] whitespace-nowrap">Sort by:</span>
            <select
              className="pleros-input text-xs font-medium min-w-[140px]"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
            >
              <option value="name">Product Name (A–Z)</option>
              <option value="price-asc">Price (Low to High)</option>
              <option value="price-desc">Price (High to Low)</option>
              <option value="newest">Recently Added</option>
            </select>
          </div>
        </div>

        {/* Results Header */}
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--c-border)]">
          <div className="text-xs text-[var(--c-text-3)]">
            {meta && !loading ? (
              <span>
                Showing <strong className="text-pleros-white">{start}–{end}</strong> of{' '}
                <strong className="text-pleros-white">{meta.total}</strong> products
              </span>
            ) : (
              <span>Loading products…</span>
            )}
          </div>

          {currentWhObj && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-[var(--c-text-3)]">
              <span>Stock Source:</span>
              <span className="font-semibold text-pleros-white">{currentWhObj.name}</span>
            </div>
          )}
        </div>

        {err && (
          <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs mb-4">
            {err}
          </div>
        )}

        {/* Skeleton Loader */}
        {loading && items.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-80 rounded-2xl animate-pulse"
                style={{ background: 'var(--c-surface-2)' }}
              />
            ))}
          </div>
        )}

        {/* Product Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 flex-1">
          {sorted.map((sku) => {
            const avail = sku.quantityAvailable ?? 0
            const oos = avail <= 0
            const lowStock = !oos && avail <= 5
            const theme = getCategoryTheme(sku.category, sku.name, sku.code)
            const qty = getQty(sku.id)
            const isAdded = recentlyAddedSkuId === sku.id

            return (
              <article
                key={sku.id}
                className="pleros-card flex flex-col justify-between rounded-2xl border p-4 transition-all duration-200 hover:-translate-y-1 hover:border-slate-600 hover:shadow-xl group"
                style={{
                  background: 'var(--c-surface)',
                  borderColor: 'var(--c-border-card)',
                  opacity: oos ? 0.75 : 1,
                }}
              >
                <div>
                  {/* Visual Artwork Box */}
                  <div
                    className="relative h-40 rounded-xl flex items-center justify-center mb-3 overflow-hidden border transition-transform duration-300 group-hover:scale-[1.02]"
                    style={{
                      background: theme.bgGradient,
                      borderColor: 'rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    {/* Glowing Orb */}
                    <div
                      className="absolute w-28 h-28 rounded-full opacity-40 blur-xl pointer-events-none"
                      style={{ background: theme.accentColor }}
                    />

                    {/* Category Icon */}
                    <div className="relative z-10 w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-lg border border-white/10 backdrop-blur-md bg-black/30">
                      {theme.icon}
                    </div>

                    {/* SKU Code Pill Top-Left */}
                    <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md font-mono text-[10px] font-bold tracking-wider text-slate-300 bg-black/60 border border-white/10 backdrop-blur-sm">
                      {sku.code}
                    </div>

                    {/* Stock Status Badge Top-Right */}
                    <div className="absolute top-2.5 right-2.5">
                      {oos ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-rose-300 bg-rose-950/80 border border-rose-500/40 backdrop-blur-sm">
                          Out of stock
                        </span>
                      ) : lowStock ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider text-amber-300 bg-amber-950/80 border border-amber-500/40 backdrop-blur-sm flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                          <span>{avail} left</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider text-emerald-300 bg-emerald-950/80 border border-emerald-500/40 backdrop-blur-sm flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          <span>{avail} in stock</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Category Label */}
                  <div className="flex items-center gap-1 mb-1">
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ color: theme.accentColor, background: theme.badgeBg }}
                    >
                      {sku.category || theme.label}
                    </span>
                  </div>

                  {/* Product Title */}
                  <h3 className="font-bold text-sm text-pleros-white leading-snug line-clamp-2 mb-2 font-display">
                    {sku.name}
                  </h3>

                  {/* Pricing & Contract Badge */}
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-xl font-bold font-display text-white">
                      ${toPrice(sku.price).toFixed(2)}
                    </span>
                    {sku.priceSource === 'contract' && sku.listPrice != null ? (
                      <span className="text-xs text-slate-500 line-through">
                        ${toPrice(sku.listPrice).toFixed(2)}
                      </span>
                    ) : null}
                    {sku.priceSource === 'contract' && (
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                        Contract Tier
                      </span>
                    )}
                  </div>
                </div>

                {/* Cart Action & Quantity Stepper */}
                <div className="pt-3 border-t border-[var(--c-border)] flex items-center gap-2">
                  <div className="flex-shrink-0">
                    <div className="flex items-center rounded-lg border bg-black/20 overflow-hidden" style={{ borderColor: 'var(--c-border)' }}>
                      <button
                        type="button"
                        disabled={oos || qty <= 1}
                        onClick={() => setQty(sku.id, qty - 1)}
                        className="w-7 h-8 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={avail > 0 ? avail : undefined}
                        disabled={oos}
                        value={qty}
                        onChange={(e) => {
                          const parsed = Number.parseInt(e.target.value, 10)
                          if (!Number.isNaN(parsed) && parsed >= 1) {
                            setQty(sku.id, avail > 0 ? Math.min(parsed, avail) : parsed)
                          }
                        }}
                        className="w-10 h-8 text-center text-xs font-mono font-bold bg-transparent text-white border-x focus:outline-none"
                        style={{ borderColor: 'var(--c-border)' }}
                      />
                      <button
                        type="button"
                        disabled={oos || (avail > 0 && qty >= avail)}
                        onClick={() => setQty(sku.id, avail > 0 ? Math.min(avail, qty + 1) : qty + 1)}
                        className="w-7 h-8 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={oos}
                    onClick={() => onAdd(sku)}
                    className={`btn-primary flex-1 !py-2 !px-3 text-xs font-bold transition-all duration-200 flex items-center justify-center gap-1.5 ${
                      isAdded ? '!bg-emerald-500 !text-slate-950 shadow-emerald-500/30' : ''
                    }`}
                  >
                    {isAdded ? (
                      <>
                        <span>✓</span> Added
                      </>
                    ) : oos ? (
                      'Out of Stock'
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                        </svg>
                        <span>Add</span>
                      </>
                    )}
                  </button>
                </div>
              </article>
            )
          })}
        </div>

        {/* Empty Search / Filter State */}
        {!loading && sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center p-12 text-center my-auto rounded-2xl border border-dashed border-[var(--c-border)]">
            <span className="text-4xl mb-3">🔍</span>
            <h3 className="text-base font-bold text-pleros-white">No products found</h3>
            <p className="text-xs text-[var(--c-text-3)] max-w-sm mt-1 mb-4">
              We couldn&apos;t find any items matching your current filters or warehouse selection.
            </p>
            <button
              type="button"
              onClick={() => {
                setCategory('')
                setInStockOnly(false)
                setPriceMin('')
                setPriceMax('')
                setQ('')
                setPage(1)
              }}
              className="btn-ghost !text-xs"
            >
              Clear all filters
            </button>
          </div>
        )}

        {/* Pagination Footer */}
        {meta && meta.total > meta.pageSize && (
          <div className="flex items-center justify-between pt-6 mt-8 border-t border-[var(--c-border)]">
            <p className="text-xs text-[var(--c-text-3)]">
              Page {page} of {Math.ceil(meta.total / meta.pageSize)}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost !py-1.5 !px-3 text-xs"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Previous
              </button>
              <button
                type="button"
                className="btn-ghost !py-1.5 !px-3 text-xs"
                disabled={!meta.hasMore || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
