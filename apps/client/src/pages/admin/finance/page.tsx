import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/cosmos/status-badge'
import { EmptyState } from '@/components/cosmos/empty-state'

type OrderRow = {
  id: string
  customerId: string
  status: string
  totalAmount: string | number
  amountPaid?: string | number
  createdAt: string
  paymentMethod: string
}

type OrderList = { items: OrderRow[]; total: number }

type PoRow = {
  id: string
  number: string
  status: string
  amountPaid?: string | number
  supplier: { id: string; name: string }
  lines: { qtyOrdered: number; qtyReceived: number; unitCost: string | number | null }[]
}

type TrialRow = {
  accountCode: string
  accountName: string
  type: string
  debits: number
  credits: number
  netBalance: number
}

type CashflowBucket = {
  label?: string
  period?: string
  projected_net: number
  projected_inflow: number
  projected_outflow: number
}

type CashflowResp = {
  tenant_id: string
  weekly_net_baseline: number
  forecast: CashflowBucket[]
  warnings: string[]
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function orderBalance(o: OrderRow): number {
  const t = Number(o.totalAmount)
  const p = Number(o.amountPaid ?? 0)
  return Math.max(0, t - p)
}

function invoiceStatus(o: OrderRow): string {
  const b = orderBalance(o)
  const t = Number(o.totalAmount)
  if (o.status === 'CANCELLED' || o.status === 'FAILED') return o.status
  if (b <= 0.01) return 'PAID'
  if (Number(o.amountPaid ?? 0) > 0) return 'PARTIALLY_PAID'
  const days = (Date.now() - new Date(o.createdAt).getTime()) / (86400 * 1000)
  if (days > 30 && o.paymentMethod === 'NET_TERMS') return 'OVERDUE'
  return 'ISSUED'
}

function poTotal(po: PoRow): number {
  return po.lines.reduce((s, l) => {
    const c = l.unitCost != null ? Number(l.unitCost) : 0
    return s + l.qtyOrdered * c
  }, 0)
}

function poBalance(po: PoRow): number {
  const t = poTotal(po)
  const p = Number(po.amountPaid ?? 0)
  return Math.max(0, t - p)
}

function apStatus(po: PoRow): string {
  const b = poBalance(po)
  if (po.status === 'CANCELLED') return 'VOIDED'
  if (b <= 0.01) return 'PAID'
  if (Number(po.amountPaid ?? 0) > 0) return 'PARTIALLY_PAID'
  return 'ISSUED'
}

export default function FinancePage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'invoices' | 'bills' | 'trial' | 'cashflow'>('invoices')
  const [invFilter, setInvFilter] = useState('ALL')
  const [apFilter, setApFilter] = useState('ALL')
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [cfHorizon, setCfHorizon] = useState<30 | 60 | 90>(30)

  const [payOrder, setPayOrder] = useState<OrderRow | null>(null)
  const [payPo, setPayPo] = useState<PoRow | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'CASH' | 'CHECK' | 'ACH' | 'CARD'>('ACH')

  const ordersQ = useQuery({
    queryKey: ['finance', 'orders-ar'],
    queryFn: () => api.get<OrderList>('/orders?page=1&pageSize=200'),
    enabled: tab === 'invoices',
  })

  const posQ = useQuery({
    queryKey: ['finance', 'pos-ap'],
    queryFn: () => api.get<PoRow[]>('/purchase-orders'),
    enabled: tab === 'bills',
  })

  const trialQ = useQuery({
    queryKey: ['finance', 'trial', year, month],
    queryFn: () => api.get<TrialRow[]>(`/reports/trial-balance?year=${year}&month=${month}`),
    enabled: tab === 'trial',
  })

  type KpiSnap = { tenantId: string; date: string; revenue: string | number }
  const snapsQ = useQuery({
    queryKey: ['finance', 'kpi-snapshots'],
    queryFn: () => api.get<KpiSnap[]>('/kpi/snapshots'),
    enabled: tab === 'cashflow',
  })

  const cashInput = useMemo(() => {
    const rows = [...(snapsQ.data ?? [])].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    )
    if (rows.length < 2) return null
    const tail = rows.slice(-20)
    const tenantId = tail[tail.length - 1]?.tenantId ?? 'tenant'
    const history = tail.map((s) => {
      const inflow = Number(s.revenue)
      return { period: new Date(s.date).toISOString().slice(0, 10), inflow, outflow: Math.max(0, inflow * 0.55) }
    })
    return {
      tenant_id: tenantId,
      history,
      horizon_weeks: Math.max(1, Math.ceil(cfHorizon / 7)),
    }
  }, [snapsQ.data, cfHorizon])

  const cashQ = useQuery({
    queryKey: ['finance', 'cashflow', cfHorizon, (snapsQ.data ?? []).length],
    enabled: tab === 'cashflow' && !!cashInput,
    queryFn: async () => {
      const res = await fetch('/api/cashflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cashInput),
      })
      const j = (await res.json()) as CashflowResp & { message?: string }
      if (!res.ok) throw new Error(j.message ?? 'Cashflow failed')
      return j
    },
  })

  const aging = useMemo(() => {
    const rows = ordersQ.data?.items ?? []
    const open = rows.filter((o) => orderBalance(o) > 0.01 && !['CANCELLED', 'FAILED'].includes(o.status))
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 }
    const now = Date.now()
    for (const o of open) {
      const days = (now - new Date(o.createdAt).getTime()) / (86400 * 1000)
      const b = orderBalance(o)
      if (days <= 30) buckets.current += b
      else if (days <= 60) buckets.d30 += b
      else if (days <= 90) buckets.d60 += b
      else if (days <= 120) buckets.d90 += b
      else buckets.d90p += b
    }
    return buckets
  }, [ordersQ.data])

  const filteredInvoices = useMemo(() => {
    const rows = ordersQ.data?.items ?? []
    return rows.filter((o) => {
      const st = invoiceStatus(o)
      if (invFilter === 'ALL') return !['CANCELLED', 'FAILED'].includes(o.status)
      return st === invFilter
    })
  }, [ordersQ.data, invFilter])

  const filteredBills = useMemo(() => {
    const rows = posQ.data ?? []
    return rows.filter((po) => {
      if (po.status === 'CANCELLED') return false
      if (apFilter === 'ALL') return poBalance(po) > 0.01 || Number(po.amountPaid ?? 0) > 0
      return apStatus(po) === apFilter
    })
  }, [posQ.data, apFilter])

  const payOrderMut = useMutation({
    mutationFn: async () => {
      if (!payOrder) return
      await api.post(`/orders/${payOrder.id}/payments`, {
        amount: parseFloat(payAmount),
        method: payMethod,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'orders-ar'] })
      setPayOrder(null)
      setPayAmount('')
    },
  })

  const payPoMut = useMutation({
    mutationFn: async () => {
      if (!payPo) return
      await api.post(`/purchase-orders/${payPo.id}/payments`, {
        amount: parseFloat(payAmount),
        method: payMethod,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'pos-ap'] })
      setPayPo(null)
      setPayAmount('')
    },
  })

  function exportTrialCsv() {
    const rows = trialQ.data ?? []
    const head = ['Account Code', 'Account Name', 'Type', 'Debits', 'Credits', 'Net']
    const lines = [head.join(','), ...rows.map((r) =>
      [r.accountCode, `"${r.accountName.replace(/"/g, '""')}"`, r.type, r.debits, r.credits, r.netBalance].join(','))]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cosmos-trial-balance-${year}-${String(month).padStart(2, '0')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const cfChart = useMemo(() => {
    const fc = cashQ.data?.forecast ?? []
    if (fc.length === 0) return []
    let bal = cashQ.data?.weekly_net_baseline ?? 0
    return fc.map((w, i) => {
      bal += w.projected_net
      return {
        i,
        label: w.label ?? w.period ?? String(i),
        closing: bal,
        neg: bal < 0 ? bal : 0,
      }
    })
  }, [cashQ.data])

  return (
    <div className="p-6 space-y-6" style={{ fontFamily: 'var(--font-body)' }}>
      <div>
        <h1 className="text-2xl font-bold text-cosmos-white" style={{ fontFamily: 'var(--font-display)' }}>
          Finance
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>
          AR (orders), AP (purchase orders), trial balance, and cash outlook
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['invoices', 'bills', 'trial', 'cashflow'] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setTab(id)}
          >
            {id === 'invoices' ? 'Invoices (AR)' : id === 'bills' ? 'Bills (AP)' : id === 'trial' ? 'Trial balance' : 'Cash flow'}
          </button>
        ))}
      </div>

      {tab === 'invoices' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { k: 'current', label: 'Current (0–30d)', v: aging.current, color: 'var(--c-success)' },
              { k: 'd30', label: '1–30 Days', v: aging.d30, color: 'var(--c-warning)' },
              { k: 'd60', label: '31–60 Days', v: aging.d60, color: '#ea580c' },
              { k: 'd90', label: '61–90 Days', v: aging.d90, color: 'var(--c-danger)' },
              { k: 'd90p', label: '90+ Days', v: aging.d90p, color: '#b91c1c' },
            ].map((c) => (
              <div key={c.k} className="cosmos-card metric-accent" style={{ borderLeftColor: c.color }}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>{c.label}</div>
                <div className="text-lg font-mono font-semibold mt-2" style={{ color: 'var(--c-heading)' }}>{money(c.v)}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {['ALL', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'FAILED'].map((s) => (
              <button key={s} type="button" className={invFilter === s ? 'btn-primary' : 'btn-ghost'} onClick={() => setInvFilter(s)}>
                {s}
              </button>
            ))}
          </div>
          <div className="cosmos-card overflow-x-auto">
            {ordersQ.isLoading ? <div className="skeleton h-40 w-full" /> : ordersQ.isError ? (
              <p style={{ color: 'var(--c-danger)' }}>Could not load orders</p>
            ) : filteredInvoices.length === 0 ? (
              <EmptyState icon="📄" title="No invoices" description="Orders with an outstanding balance appear here." />
            ) : (
              <table className="cosmos-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Issue</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((o) => (
                    <tr key={o.id}>
                      <td className="font-mono text-xs">{o.id.slice(0, 12)}…</td>
                      <td>{o.customerId.slice(0, 12)}…</td>
                      <td className="text-sm" style={{ color: 'var(--c-text-2)' }}>{new Date(o.createdAt).toLocaleDateString()}</td>
                      <td className="font-mono">{money(Number(o.totalAmount))}</td>
                      <td className="font-mono">{money(Number(o.amountPaid ?? 0))}</td>
                      <td className="font-mono">{money(orderBalance(o))}</td>
                      <td><StatusBadge status={invoiceStatus(o)} /></td>
                      <td className="space-x-2">
                        {orderBalance(o) > 0.01 && !['CANCELLED', 'FAILED'].includes(o.status) && (
                          <button type="button" className="btn-primary !py-1 !px-2 !text-xs" onClick={() => {
                            setPayOrder(o)
                            setPayAmount(String(orderBalance(o).toFixed(2)))
                          }}>Record payment</button>
                        )}
                        <Link to={`/orders/${o.id}`} className="text-sm" style={{ color: 'var(--c-accent)' }}>View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'bills' && (
        <>
          <div className="flex flex-wrap gap-2">
            {['ALL', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOIDED'].map((s) => (
              <button key={s} type="button" className={apFilter === s ? 'btn-primary' : 'btn-ghost'} onClick={() => setApFilter(s)}>
                {s}
              </button>
            ))}
          </div>
          <div className="cosmos-card overflow-x-auto">
            {posQ.isLoading ? <div className="skeleton h-40 w-full" /> : posQ.isError ? (
              <p style={{ color: 'var(--c-danger)' }}>Could not load purchase orders</p>
            ) : filteredBills.length === 0 ? (
              <EmptyState icon="📥" title="No bills" description="Submitted POs with a balance appear here." />
            ) : (
              <table className="cosmos-table">
                <thead>
                  <tr>
                    <th>PO #</th>
                    <th>Supplier</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredBills.map((po) => (
                    <tr key={po.id}>
                      <td className="font-mono">{po.number}</td>
                      <td>{po.supplier.name}</td>
                      <td className="font-mono">{money(poTotal(po))}</td>
                      <td className="font-mono">{money(Number(po.amountPaid ?? 0))}</td>
                      <td className="font-mono">{money(poBalance(po))}</td>
                      <td><StatusBadge status={apStatus(po)} /></td>
                      <td className="space-x-2">
                        {poBalance(po) > 0.01 && (
                          <button type="button" className="btn-primary !py-1 !px-2 !text-xs" onClick={() => {
                            setPayPo(po)
                            setPayAmount(String(poBalance(po).toFixed(2)))
                          }}>Mark paid</button>
                        )}
                        <Link to={`/purchasing/${po.id}`} style={{ color: 'var(--c-accent)' }}>View PO</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'trial' && (
        <div className="cosmos-card space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <label className="text-sm" style={{ color: 'var(--c-text-2)' }}>Month</label>
            <select className="cosmos-input max-w-[120px]" value={month} onChange={(e) => setMonth(+e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString('default', { month: 'short' })}</option>
              ))}
            </select>
            <label className="text-sm" style={{ color: 'var(--c-text-2)' }}>Year</label>
            <select className="cosmos-input max-w-[100px]" value={year} onChange={(e) => setYear(+e.target.value)}>
              {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="button" className="btn-ghost" onClick={() => void trialQ.refetch()}>Load</button>
            <button type="button" className="btn-primary" onClick={exportTrialCsv} disabled={!(trialQ.data?.length)}>Export CSV</button>
          </div>
          {trialQ.isLoading ? <div className="skeleton h-48 w-full" /> : trialQ.isError ? (
            <p style={{ color: 'var(--c-danger)' }}>Could not load trial balance</p>
          ) : (trialQ.data?.length ?? 0) === 0 ? (
            <EmptyState icon="📊" title="No posted journals" description="Post journal entries for this month to see balances." />
          ) : (
            <table className="cosmos-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Debits</th>
                  <th>Credits</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {(trialQ.data ?? []).map((r) => (
                  <tr key={r.accountCode}>
                    <td className="font-mono">{r.accountCode}</td>
                    <td>{r.accountName}</td>
                    <td><StatusBadge status={r.type} /></td>
                    <td className="font-mono">{money(r.debits)}</td>
                    <td className="font-mono">{money(r.credits)}</td>
                    <td className="font-mono" style={{ color: r.netBalance < 0 ? 'var(--c-danger)' : 'var(--c-text)' }}>
                      {money(r.netBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'cashflow' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {[30, 60, 90].map((h) => (
              <button key={h} type="button" className={cfHorizon === h ? 'btn-primary' : 'btn-ghost'} onClick={() => setCfHorizon(h as 30 | 60 | 90)}>
                {h} days
              </button>
            ))}
          </div>
          <div className="cosmos-card">
            {!cashInput ? (
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Need KPI snapshots from analytics to run cashflow. Open dashboard once data exists.</p>
            ) : cashQ.isLoading ? <div className="skeleton h-64 w-full" /> : cashQ.isError ? (
              <p style={{ color: 'var(--c-danger)' }}>{cashQ.error instanceof Error ? cashQ.error.message : 'Error'}</p>
            ) : (
              <>
                <p className="text-sm mb-4" style={{ color: 'var(--c-text-3)' }}>Weekly buckets from native EWMA forecast (no Python sidecar)</p>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cfChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="cfPos" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--c-primary)" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="var(--c-primary)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" />
                      <XAxis dataKey="label" tick={{ fill: 'var(--c-text-3)', fontSize: 10 }} />
                      <YAxis tick={{ fill: 'var(--c-text-3)', fontSize: 10 }} tickFormatter={(v) => money(v)} />
                      <Tooltip
                        contentStyle={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', borderRadius: 8 }}
                        formatter={(v: number) => [money(v), 'Closing']}
                      />
                      <Area type="monotone" dataKey="closing" stroke="var(--c-primary)" fill="url(#cfPos)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {(cashQ.data?.warnings?.length ?? 0) > 0 && (
                  <ul className="mt-4 text-xs text-amber-400 list-disc pl-5">{cashQ.data!.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {(payOrder || payPo) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }}>
          <div className="cosmos-card max-w-md w-full space-y-4">
            <h3 style={{ color: 'var(--c-heading)', fontFamily: 'var(--font-display)' }}>Record payment</h3>
            <label className="block text-sm" style={{ color: 'var(--c-text-2)' }}>Amount</label>
            <input className="cosmos-input" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            <label className="block text-sm" style={{ color: 'var(--c-text-2)' }}>Method</label>
            <select className="cosmos-input" value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}>
              {(['CASH', 'CHECK', 'ACH', 'CARD'] as const).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-ghost" onClick={() => { setPayOrder(null); setPayPo(null) }}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                disabled={payOrderMut.isPending || payPoMut.isPending}
                onClick={() => {
                  if (payOrder) void payOrderMut.mutate()
                  else void payPoMut.mutate()
                }}
              >Submit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
