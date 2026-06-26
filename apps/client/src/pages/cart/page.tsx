import { Link } from 'react-router-dom'
import { useCartStore } from '@/stores/cart.store'

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 24px' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🛒</div>
      <p style={{ color: 'var(--c-text)', fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-display)', marginBottom: 8 }}>Your cart is empty</p>
      <p style={{ color: 'var(--c-text-3)', fontSize: 14, marginBottom: 24 }}>Browse the catalog and add products.</p>
      <Link to="/catalog" className="btn-primary inline-block">
        Browse Catalog
      </Link>
    </div>
  )
}

export default function CartPage() {
  const items = useCartStore((s) => s.items)
  const setQty = useCartStore((s) => s.setQty)
  const removeItem = useCartStore((s) => s.removeItem)
  const subtotal = useCartStore((s) => s.subtotal())
  const clear = useCartStore((s) => s.clear)

  if (items.length === 0) {
    return (
      <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
        <EmptyState />
      </div>
    )
  }

  return (
    <div style={{ padding: 24, display: 'flex', gap: 24, flexWrap: 'wrap', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ flex: '2 1 400px' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--c-heading)', marginBottom: 20 }}>Cart</h1>
        <table className="pleros-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>SKU</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Line</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.skuId}>
                <td>{i.skuName}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{i.skuCode}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      className="btn-ghost !py-1 !px-2"
                      onClick={() => setQty(i.skuId, i.quantity - 1)}
                    >
                      −
                    </button>
                    <input
                      className="pleros-input"
                      style={{ width: 56, padding: '6px 8px' }}
                      value={i.quantity}
                      onChange={(e) => setQty(i.skuId, Number.parseInt(e.target.value, 10) || 0)}
                    />
                    <button type="button" className="btn-ghost !py-1 !px-2" onClick={() => setQty(i.skuId, i.quantity + 1)}>
                      +
                    </button>
                  </div>
                </td>
                <td>${i.unitPrice.toFixed(2)}</td>
                <td>${(i.quantity * i.unitPrice).toFixed(2)}</td>
                <td>
                  <button type="button" style={{ background: 'none', border: 'none', color: 'var(--c-danger)', cursor: 'pointer' }} onClick={() => removeItem(i.skuId)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Link to="/catalog" style={{ color: 'var(--c-accent)', display: 'inline-block', marginTop: 16 }}>
          Continue shopping
        </Link>
      </div>
      <aside className="pleros-card" style={{ flex: '1 1 260px', alignSelf: 'flex-start' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', marginTop: 0 }}>Summary</h3>
        <p style={{ color: 'var(--c-text-3)', fontSize: 14 }}>Subtotal</p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 18 }}>${subtotal.toFixed(2)}</p>
        <p style={{ color: 'var(--c-text-3)', fontSize: 13, marginTop: 12 }}>Tax calculated at checkout</p>
        <p style={{ fontWeight: 700, marginTop: 16 }}>Total ${subtotal.toFixed(2)}</p>
        <Link to="/checkout" className="btn-primary" style={{ textDecoration: 'none', width: '100%', display: 'block', textAlign: 'center' }}>
          Proceed to Checkout
        </Link>
        <button type="button" className="btn-ghost" style={{ width: '100%', marginTop: 12 }} onClick={() => clear()}>
          Clear cart
        </button>
      </aside>
    </div>
  )
}
