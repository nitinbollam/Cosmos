import { Link } from 'react-router-dom'
import { useCartStore } from '@/stores/cart.store'

function getCategoryIcon(name?: string, code?: string) {
  const text = `${name || ''} ${code || ''}`.toLowerCase()
  if (text.includes('bev') || text.includes('drink') || text.includes('energy') || text.includes('soda')) return '🥤'
  if (text.includes('vap') || text.includes('nic') || text.includes('pod') || text.includes('mod')) return '💨'
  if (text.includes('snack') || text.includes('chip') || text.includes('food') || text.includes('candy')) return '🍫'
  if (text.includes('acc') || text.includes('cable') || text.includes('charg') || text.includes('usb')) return '🔌'
  if (text.includes('stand') || text.includes('display') || text.includes('rack')) return '📦'
  return '🏷️'
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-6 bg-sky-500/10 border border-sky-500/20 shadow-xl">
        🛒
      </div>
      <h2 className="text-2xl font-bold text-pleros-white font-display mb-2">Your wholesale cart is empty</h2>
      <p className="text-sm text-[var(--c-text-3)] max-w-sm mb-8 leading-relaxed">
        Browse your customer catalog to add inventory, review volume pricing, and place orders with net terms.
      </p>
      <Link to="/catalog" className="btn-primary !py-3 !px-8 text-sm font-semibold shadow-lg shadow-sky-500/20">
        Browse Catalog →
      </Link>
    </div>
  )
}

export default function CartPage() {
  const items = useCartStore((s) => s.items)
  const setQty = useCartStore((s) => s.setQty)
  const removeItem = useCartStore((s) => s.removeItem)
  const subtotal = useCartStore((s) => s.subtotal())
  const totalCount = useCartStore((s) => s.count())
  const clear = useCartStore((s) => s.clear)

  if (items.length === 0) {
    return (
      <div className="min-h-[calc(100vh-64px)] max-w-5xl mx-auto p-6">
        <EmptyState />
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-[var(--c-background)] text-[var(--c-text)] p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Checkout Steps Progression */}
        <div className="flex items-center justify-between gap-4 mb-8 pb-4 border-b border-[var(--c-border)]">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-pleros-white font-display">Shopping Cart</h1>
              <span className="text-xs font-semibold font-mono px-2.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30">
                {totalCount} {totalCount === 1 ? 'item' : 'items'}
              </span>
            </div>
            <p className="text-xs text-[var(--c-text-3)] mt-1">Review line items and quantities before checkout</p>
          </div>

          <div className="hidden sm:flex items-center gap-3 text-xs font-semibold">
            <span className="text-sky-400 flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-sky-500 text-slate-950 flex items-center justify-center text-[10px] font-bold">1</span>
              <span>Cart</span>
            </span>
            <span className="text-[var(--c-border)]">→</span>
            <span className="text-[var(--c-text-3)] flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px]">2</span>
              <span>Shipping & Terms</span>
            </span>
            <span className="text-[var(--c-border)]">→</span>
            <span className="text-[var(--c-text-3)] flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px]">3</span>
              <span>Confirmation</span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Line Items List */}
          <div className="lg:col-span-8 space-y-4">
            <div className="rounded-2xl border border-[var(--c-border-card)] bg-[var(--c-surface)] overflow-hidden">
              <div className="divide-y divide-[var(--c-border)]">
                {items.map((item) => {
                  const icon = getCategoryIcon(item.skuName, item.skuCode)
                  const lineTotal = item.quantity * item.unitPrice

                  return (
                    <div
                      key={item.skuId}
                      className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors hover:bg-white/[0.02]"
                    >
                      {/* Product Info */}
                      <div className="flex items-start gap-3.5 flex-1 min-w-0">
                        <div className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center text-2xl bg-slate-900/60 border border-white/10 shadow-inner">
                          {icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-mono text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-black/40 text-slate-300 border border-white/5">
                              {item.skuCode}
                            </span>
                            {item.warehouseId && (
                              <span className="text-[10px] text-[var(--c-text-3)] truncate">
                                • Fulfilled from warehouse
                              </span>
                            )}
                          </div>
                          <h3 className="text-sm sm:text-base font-bold text-pleros-white font-display truncate">
                            {item.skuName}
                          </h3>
                          <div className="text-xs text-[var(--c-text-3)] mt-0.5">
                            ${item.unitPrice.toFixed(2)} per unit
                          </div>
                        </div>
                      </div>

                      {/* Quantity Stepper & Line Total */}
                      <div className="flex items-center justify-between sm:justify-end gap-6 pt-2 sm:pt-0 border-t sm:border-t-0 border-[var(--c-border)]">
                        {/* Stepper */}
                        <div className="flex items-center rounded-lg border bg-black/20 overflow-hidden" style={{ borderColor: 'var(--c-border)' }}>
                          <button
                            type="button"
                            disabled={item.quantity <= 1}
                            onClick={() => setQty(item.skuId, item.quantity - 1)}
                            className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
                            aria-label="Decrease quantity"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) => {
                              const val = Number.parseInt(e.target.value, 10)
                              if (!Number.isNaN(val) && val >= 1) setQty(item.skuId, val)
                            }}
                            className="w-12 h-8 text-center text-xs font-mono font-bold bg-transparent text-white border-x focus:outline-none"
                            style={{ borderColor: 'var(--c-border)' }}
                          />
                          <button
                            type="button"
                            onClick={() => setQty(item.skuId, item.quantity + 1)}
                            className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                            aria-label="Increase quantity"
                          >
                            +
                          </button>
                        </div>

                        {/* Price */}
                        <div className="text-right min-w-[80px]">
                          <div className="text-base sm:text-lg font-bold font-display text-pleros-white">
                            ${lineTotal.toFixed(2)}
                          </div>
                        </div>

                        {/* Remove */}
                        <button
                          type="button"
                          onClick={() => removeItem(item.skuId)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Remove item"
                          aria-label="Remove item"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Link
                to="/catalog"
                className="text-xs font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1.5"
              >
                <span>←</span> Continue Shopping
              </Link>
              <button
                type="button"
                onClick={() => clear()}
                className="text-xs text-[var(--c-text-3)] hover:text-rose-400 transition-colors"
              >
                Clear all items
              </button>
            </div>
          </div>

          {/* Order Summary Aside */}
          <aside className="lg:col-span-4 rounded-2xl border border-[var(--c-border-card)] bg-[var(--c-surface)] p-6 space-y-6 sticky top-6 shadow-xl">
            <div>
              <h2 className="text-base font-bold text-pleros-white font-display">Order Summary</h2>
              <p className="text-xs text-[var(--c-text-3)] mt-0.5">Wholesale pricing & estimated invoice total</p>
            </div>

            <div className="space-y-3 text-xs border-y border-[var(--c-border)] py-4">
              <div className="flex items-center justify-between">
                <span className="text-[var(--c-text-2)]">Items Subtotal ({totalCount})</span>
                <span className="font-mono font-semibold text-pleros-white">${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--c-text-2)]">Estimated Sales Tax</span>
                <span className="text-[var(--c-text-3)] italic">Calculated at checkout</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--c-text-2)]">Freight & Shipping</span>
                <span className="text-[var(--c-text-3)] italic">Based on delivery address</span>
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-4">
                <span className="text-sm font-bold text-pleros-white">Estimated Total</span>
                <span className="text-2xl font-bold font-display text-sky-400">
                  ${subtotal.toFixed(2)}
                </span>
              </div>

              <Link
                to="/checkout"
                className="btn-primary w-full !py-3 text-center text-sm font-bold block shadow-lg shadow-sky-500/20"
              >
                Proceed to Checkout →
              </Link>
            </div>

            {/* B2B Assurance Badges */}
            <div className="pt-4 border-t border-[var(--c-border)] space-y-2 text-[11px] text-[var(--c-text-3)]">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400">🛡️</span>
                <span>Net 30 terms & credit limit supported</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sky-400">🚚</span>
                <span>Direct warehouse allocation & live tracking</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-amber-400">🔒</span>
                <span>Instant automated invoice & GL sync</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
