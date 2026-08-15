import { Link, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'
import { getB2bCustomerId } from '@/lib/session'
import { useCartStore } from '@/stores/cart.store'
import { useStripeConnect } from '@/lib/stripe-connect'
import { StorefrontCardCapture } from '@/components/checkout-card-capture'

type CustomerProfile = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  creditLimit?: string | number | null
  creditUsed?: string | number | null
  paymentTermsDays?: number | null
  primaryAddressLine1?: string | null
  primaryCity?: string | null
  primaryState?: string | null
  primaryZip?: string | null
}

type OrderTemplate = {
  id: string
  name: string
  lines: Array<{ id: string; skuId: string; quantity: number }>
}

type SavedCard = {
  id: string
  brand?: string | null
  last4?: string | null
  expMonth?: number | null
  expYear?: number | null
  isDefault: boolean
  stripePaymentMethodId: string
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function AccountPage() {
  const navigate = useNavigate()
  const addItems = useCartStore((s) => s.addItems)
  const cartItems = useCartStore((s) => s.items)
  const [profile, setProfile] = useState<CustomerProfile | null>(null)
  const [templates, setTemplates] = useState<OrderTemplate[]>([])
  const [cards, setCards] = useState<SavedCard[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [showAddCard, setShowAddCard] = useState(false)
  const { stripePromise, chargesEnabled } = useStripeConnect(api.get.bind(api), 'account-stripe')

  const [phone, setPhone] = useState('')
  const [line1, setLine1] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [notifPrefs, setNotifPrefs] = useState({
    emailEnabled: true,
    smsEnabled: false,
    orderUpdates: true,
    invoiceAlerts: true,
  })
  const [prefsSaved, setPrefsSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const c = await api.get<CustomerProfile>('/customers/me')
      setProfile(c)
      setPhone(c.phone ?? '')
      setLine1(c.primaryAddressLine1 ?? '')
      setCity(c.primaryCity ?? '')
      setState(c.primaryState ?? '')
      setZip(c.primaryZip ?? '')
      const prefs = await api
        .get<typeof notifPrefs>('/customers/me/notification-prefs')
        .catch(() => ({ emailEnabled: true, smsEnabled: false, orderUpdates: true, invoiceAlerts: true }))
      setNotifPrefs(prefs)
      const customerId = getB2bCustomerId()
      if (customerId) {
        const [tpls, methods] = await Promise.all([
          api.get<OrderTemplate[]>(`/order-templates?customerRef=${encodeURIComponent(customerId)}`),
          api.get<SavedCard[]>('/saved-payment-methods').catch(() => [] as SavedCard[]),
        ])
        setTemplates(tpls)
        setCards(methods)
      }
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const credit = useMemo(() => {
    const limit = profile?.creditLimit != null ? Number(profile.creditLimit) : 0
    const used = profile?.creditUsed != null ? Number(profile.creditUsed) : 0
    return { limit, used, available: Math.max(0, limit - used) }
  }, [profile])

  async function saveNotificationPrefs() {
    setBusy(true)
    setErr(null)
    setPrefsSaved(false)
    try {
      const updated = await api.patch<typeof notifPrefs>('/customers/me/notification-prefs', notifPrefs)
      setNotifPrefs(updated)
      setPrefsSaved(true)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    setErr(null)
    setSaved(false)
    try {
      const updated = await api.patch<CustomerProfile>('/customers/me', {
        phone: phone.trim() || null,
        primaryAddressLine1: line1.trim() || null,
        primaryCity: city.trim() || null,
        primaryState: state.trim() || null,
        primaryZip: zip.trim() || null,
      })
      setProfile(updated)
      setSaved(true)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveTemplateFromCart() {
    const customerId = getB2bCustomerId()
    if (!customerId || cartItems.length === 0) return
    setBusy(true)
    setErr(null)
    try {
      const created = await api.post<OrderTemplate>('/order-templates', {
        customerRef: customerId,
        name: templateName.trim() || `Template ${new Date().toLocaleDateString()}`,
        lines: cartItems.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      })
      setTemplates((t) => [created, ...t])
      setTemplateName('')
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function orderTemplate(id: string) {
    setBusy(true)
    setErr(null)
    try {
      const lines = await api.get<Array<{ skuId: string; skuName: string; skuCode: string; quantity: number; unitPrice: number; warehouseId: string }>>(
        `/order-templates/${id}/cart-lines`,
      )
      addItems(
        lines.map((l) => ({
          skuId: l.skuId,
          skuName: l.skuName,
          skuCode: l.skuCode,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          warehouseId: l.warehouseId,
        })),
      )
      navigate('/cart')
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function removeTemplate(id: string) {
    await api.delete(`/order-templates/${id}`)
    setTemplates((t) => t.filter((x) => x.id !== id))
  }

  async function handleSaveCard(paymentMethodId: string) {
    setBusy(true)
    setErr(null)
    try {
      const row = await api.post<SavedCard>('/saved-payment-methods', {
        stripePaymentMethodId: paymentMethodId,
        isDefault: cards.length === 0,
      })
      setCards((c) => [row, ...c])
      setShowAddCard(false)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function removeCard(id: string) {
    await api.delete(`/saved-payment-methods/${id}`)
    setCards((c) => c.filter((x) => x.id !== id))
  }

  async function setDefaultCard(id: string) {
    const row = await api.post<SavedCard>(`/saved-payment-methods/${id}/default`, {})
    setCards((c) => c.map((x) => ({ ...x, isDefault: x.id === row.id })))
  }

  if (!getB2bCustomerId() && !loading) {
    return (
      <main className="pleros-shop-page-main">
        <h1 style={{ fontSize: 24, color: 'var(--c-heading)' }}>Account</h1>
        <p className="pleros-shop-error" style={{ marginTop: 16 }}>
          <Link to="/login" className="pleros-shop-link-accent">Sign in</Link> to view your account.
        </p>
      </main>
    )
  }

  return (
    <main className="pleros-shop-page-main">
      <h1 style={{ fontSize: 24, margin: 0, color: 'var(--c-heading)' }}>Your account</h1>
      <p className="pleros-shop-muted" style={{ marginTop: 8, fontSize: 14 }}>
        Credit terms, billing profile, and shipping address.
      </p>
      {loading ? <p className="pleros-shop-muted" style={{ marginTop: 24 }}>Loading…</p> : null}
      {err ? <p className="pleros-shop-error" style={{ marginTop: 16 }}>{err}</p> : null}
      {saved ? <p style={{ color: 'var(--c-success)', marginTop: 12 }}>Profile saved.</p> : null}

      {profile ? (
        <div style={{ marginTop: 24, display: 'grid', gap: 20, maxWidth: 720 }}>
          <div className="pleros-card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px', color: 'var(--c-heading)' }}>{profile.name}</h2>
            <p className="pleros-shop-muted" style={{ fontSize: 14 }}>{profile.email ?? '—'}</p>
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <div>
                <div className="pleros-shop-muted" style={{ fontSize: 12 }}>Credit limit</div>
                <div style={{ fontWeight: 600 }}>{credit.limit > 0 ? money(credit.limit) : '—'}</div>
              </div>
              <div>
                <div className="pleros-shop-muted" style={{ fontSize: 12 }}>Credit used</div>
                <div style={{ fontWeight: 600 }}>{money(credit.used)}</div>
              </div>
              <div>
                <div className="pleros-shop-muted" style={{ fontSize: 12 }}>Available</div>
                <div style={{ fontWeight: 600, color: 'var(--c-accent)' }}>{money(credit.available)}</div>
              </div>
              <div>
                <div className="pleros-shop-muted" style={{ fontSize: 12 }}>Payment terms</div>
                <div style={{ fontWeight: 600 }}>{profile.paymentTermsDays ?? 0} days NET</div>
              </div>
            </div>
          </div>

          <div className="pleros-card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px', color: 'var(--c-heading)' }}>Contact & address</h2>
            <label className="pleros-shop-muted" style={{ fontSize: 12 }}>Phone</label>
            <input className="pleros-input" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ marginBottom: 12 }} />
            <label className="pleros-shop-muted" style={{ fontSize: 12 }}>Address line 1</label>
            <input className="pleros-input" value={line1} onChange={(e) => setLine1(e.target.value)} style={{ marginBottom: 12 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
              <div>
                <label className="pleros-shop-muted" style={{ fontSize: 12 }}>City</label>
                <input className="pleros-input" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div>
                <label className="pleros-shop-muted" style={{ fontSize: 12 }}>State</label>
                <input className="pleros-input" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div>
                <label className="pleros-shop-muted" style={{ fontSize: 12 }}>ZIP</label>
                <input className="pleros-input" value={zip} onChange={(e) => setZip(e.target.value)} />
              </div>
            </div>
            <button type="button" className="btn-primary" style={{ marginTop: 16 }} disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save profile'}
            </button>
          </div>

          <div className="pleros-card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px', color: 'var(--c-heading)' }}>Notification preferences</h2>
            <p className="pleros-shop-muted" style={{ fontSize: 13, marginBottom: 12 }}>
              Control email and SMS alerts for orders and invoices. SMS requires a phone number on your profile.
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              {(
                [
                  ['emailEnabled', 'Email notifications'],
                  ['smsEnabled', 'SMS notifications (requires phone)'],
                  ['orderUpdates', 'Order confirmations & shipping'],
                  ['invoiceAlerts', 'Invoices & payment receipts'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={notifPrefs[key]}
                    onChange={(e) => setNotifPrefs((p) => ({ ...p, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
            {prefsSaved ? <p style={{ color: 'var(--c-success)', marginTop: 12, fontSize: 13 }}>Preferences saved.</p> : null}
            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: 16 }}
              disabled={busy}
              onClick={() => void saveNotificationPrefs()}
            >
              {busy ? 'Saving…' : 'Save notification preferences'}
            </button>
          </div>

          <div className="pleros-card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px', color: 'var(--c-heading)' }}>Order templates</h2>
            <p className="pleros-shop-muted" style={{ fontSize: 13, marginBottom: 12 }}>
              Save your cart as a reusable order list with current contract prices applied when you reorder.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <input
                className="pleros-input"
                placeholder="Template name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                style={{ flex: '1 1 160px' }}
              />
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || cartItems.length === 0}
                onClick={() => void saveTemplateFromCart()}
              >
                Save current cart
              </button>
            </div>
            {templates.length === 0 ? (
              <p className="pleros-shop-muted" style={{ fontSize: 13 }}>No templates yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {templates.map((t) => (
                  <li
                    key={t.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '8px 0',
                      borderTop: '1px solid var(--c-border)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{t.name}</div>
                      <div className="pleros-shop-muted" style={{ fontSize: 12 }}>
                        {t.lines.length} line{t.lines.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn-primary" disabled={busy} onClick={() => void orderTemplate(t.id)}>
                        Order again
                      </button>
                      <button type="button" className="btn-ghost" disabled={busy} onClick={() => void removeTemplate(t.id)}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="pleros-card" style={{ padding: 16 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px', color: 'var(--c-heading)' }}>Saved payment methods</h2>
            <p className="pleros-shop-muted" style={{ fontSize: 13, marginBottom: 12 }}>
              Store cards securely for faster checkout and invoice pay.
            </p>
            {cards.length === 0 && !showAddCard ? (
              <p className="pleros-shop-muted" style={{ fontSize: 13, marginBottom: 12 }}>No saved cards.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'grid', gap: 8 }}>
                {cards.map((c) => (
                  <li key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span>
                      {(c.brand ?? 'Card').toUpperCase()} •••• {c.last4 ?? '????'}
                      {c.isDefault ? <span style={{ marginLeft: 8, color: 'var(--c-accent)', fontSize: 12 }}>Default</span> : null}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {!c.isDefault ? (
                        <button type="button" className="btn-ghost" onClick={() => void setDefaultCard(c.id)}>
                          Make default
                        </button>
                      ) : null}
                      <button type="button" className="btn-ghost" onClick={() => void removeCard(c.id)}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {showAddCard ? (
              stripePromise && chargesEnabled ? (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
                  <Elements stripe={stripePromise} options={{ appearance: { theme: 'stripe' } }}>
                    <StorefrontCardCapture onPaymentMethodId={(pmId) => void handleSaveCard(pmId)} />
                  </Elements>
                  <button type="button" className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setShowAddCard(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <p className="pleros-shop-muted" style={{ fontSize: 13, marginTop: 8 }}>
                  Card saving is unavailable until your distributor completes Stripe Connect onboarding.
                </p>
              )
            ) : (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowAddCard(true)}
              >
                + Add new card
              </button>
            )}
          </div>

          <p style={{ fontSize: 13 }}>
            <Link to="/invoices" className="pleros-shop-link-accent">View open invoices →</Link>
          </p>
        </div>
      ) : null}
    </main>
  )
}
