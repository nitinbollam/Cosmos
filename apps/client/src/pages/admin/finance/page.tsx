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
import { adminPath } from '@/lib/admin-path'
import { downloadCsv } from '@/lib/csv-download'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'

type InvoiceRow = {
  id: string
  orderId: string
  invoiceNumber: string
  customerId: string
  status: string
  displayStatus: string
  totalAmount: string | number
  amountPaid: string | number
  amountCredited?: string | number
  balance: number
  issuedAt: string
  order?: { status: string; paymentMethod: string }
}

type InvoiceList = { items: InvoiceRow[]; total: number; page: number; pageSize: number; hasMore?: boolean }

type ArSummary = {
  invoiced: number
  collected: number
  outstanding: number
  count: number
  aging: { current: number; d30: number; d60: number; d90: number; d90p: number }
}

const INVOICES_PAGE_SIZE = 25
const EXPORT_PAGE_SIZE = 100

function invoiceListQuery(filter: string, page: number, pageSize: number): string {
  const q = new URLSearchParams()
  q.set('page', String(page))
  q.set('pageSize', String(pageSize))
  if (filter === 'ALL') q.set('excludeCancelled', '1')
  else q.set('status', filter)
  return q.toString()
}

type PoRow = {
  id: string
  number: string
  status: string
  amountPaid?: string | number
  supplier: { id: string; name: string }
  lines: { qtyOrdered: number; qtyReceived: number; unitCost: string | number | null }[]
}

type BillRow = {
  id: string
  billNumber: string
  purchaseOrderId?: string | null
  displayStatus: string
  matchStatus?: string
  matchNotes?: string | null
  poTotal?: string | number | null
  receivedTotal?: string | number | null
  totalAmount: string | number
  amountPaid: string | number
  balance: number
  issuedAt: string
  dueAt?: string | null
  supplier: { id: string; name: string }
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
  method?: string
  weekly_net_baseline: number
  forecast: CashflowBucket[]
  warnings: string[]
}

type BankAccount = {
  id: string
  name: string
  accountNumber?: string | null
  currentBalance: number | string
}

type BankSummary = {
  accounts: BankAccount[]
  unreconciledCount: number
  openingBalanceTotal?: number
  closingBalanceTotal?: number
  totalDebits?: number
  totalCredits?: number
}

type BankLine = {
  id: string
  postedAt: string
  description: string
  amount: number | string
  reference?: string | null
  bankAccount?: { name: string }
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
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
  const [tab, setTab] = useState<'invoices' | 'bills' | 'trial' | 'cashflow' | 'bank'>('invoices')
  const [invFilter, setInvFilter] = useState('ALL')
  const [apFilter, setApFilter] = useState('ALL')
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [quarter, setQuarter] = useState<number>(Math.ceil((new Date().getMonth() + 1) / 3))
  const [trialPeriodType, setTrialPeriodType] = useState<'MONTHLY' | 'QUARTERLY' | 'YEARLY'>('MONTHLY')
  const [bankSubTab, setBankSubTab] = useState<'summary' | 'debits' | 'credits' | 'unreconciled'>('summary')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [cfHorizon, setCfHorizon] = useState<30 | 60 | 90>(30)

  const [payOrder, setPayOrder] = useState<InvoiceRow | null>(null)
  const [payBill, setPayBill] = useState<BillRow | null>(null)
  const [matchBill, setMatchBill] = useState<BillRow | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'CASH' | 'CHECK' | 'ACH' | 'CARD'>('ACH')
  const [invoicePage, setInvoicePage] = useState(1)
  const [exportingInvoices, setExportingInvoices] = useState(false)

  const arSummaryQ = useQuery({
    queryKey: ['finance', 'invoices-ar-summary'],
    queryFn: () => api.get<ArSummary>('/invoices/ar-summary'),
    enabled: tab === 'invoices',
  })

  const invoicesQ = useQuery({
    queryKey: ['finance', 'invoices-ar', invoicePage, invFilter],
    queryFn: () => api.get<InvoiceList>(`/invoices?${invoiceListQuery(invFilter, invoicePage, INVOICES_PAGE_SIZE)}`),
    enabled: tab === 'invoices',
    placeholderData: (prev) => prev,
  })

  const billsQ = useQuery({
    queryKey: ['finance', 'bills-ap', startDate, endDate],
    queryFn: () => {
      const q = new URLSearchParams()
      if (startDate) q.set('startDate', startDate)
      if (endDate) q.set('endDate', endDate)
      const qs = q.toString()
      return api.get<BillRow[]>(`/bills${qs ? `?${qs}` : ''}`)
    },
    enabled: tab === 'bills',
  })

  const bankSummaryQ = useQuery({
    queryKey: ['finance', 'bank-summary', startDate, endDate],
    queryFn: () => {
      const q = new URLSearchParams({ summary: 'true' })
      if (startDate) q.set('startDate', startDate)
      if (endDate) q.set('endDate', endDate)
      return api.get<BankSummary>(`/bank-accounts?${q.toString()}`)
    },
    enabled: tab === 'bank',
  })

  const bankLinesQ = useQuery({
    queryKey: ['finance', 'bank-lines', bankSubTab, startDate, endDate],
    queryFn: () => {
      if (bankSubTab === 'unreconciled') return api.get<BankLine[]>('/bank-accounts/unreconciled')
      const typeParam = bankSubTab === 'debits' ? 'DEBIT' : bankSubTab === 'credits' ? 'CREDIT' : 'ALL'
      const q = new URLSearchParams({ type: typeParam })
      if (startDate) q.set('startDate', startDate)
      if (endDate) q.set('endDate', endDate)
      return api.get<BankLine[]>(`/bank-accounts/lines?${q.toString()}`)
    },
    enabled: tab === 'bank',
  })

  const trialQ = useQuery({
    queryKey: ['finance', 'trial', year, trialPeriodType, month, quarter],
    queryFn: () =>
      api.get<TrialRow[]>(
        `/reports/trial-balance?year=${year}&periodType=${trialPeriodType}&month=${month}&quarter=${quarter}`,
      ),
    enabled: tab === 'trial',
  })

  type CashflowHistoryResp = {
    tenantId: string
    source: 'ar_ap' | 'revenue_proxy'
    history: Array<{ period: string; inflow: number; outflow: number }>
    warnings: string[]
  }

  const cashHistQ = useQuery({
    queryKey: ['finance', 'cashflow-history'],
    queryFn: () => api.get<CashflowHistoryResp>('/analytics/cashflow-history?weeks=16'),
    enabled: tab === 'cashflow',
  })

  const cashInput = useMemo(() => {
    const hist = cashHistQ.data?.history ?? []
    const active = hist.filter((p) => p.inflow > 0 || p.outflow > 0)
    if (active.length < 3) return null
    return {
      tenant_id: cashHistQ.data?.tenantId ?? 'tenant',
      history: hist,
      horizon_weeks: Math.max(1, Math.ceil(cfHorizon / 7)),
      seasonal_period: hist.length >= 8 ? 4 : null,
    }
  }, [cashHistQ.data, cfHorizon])

  const cashQ = useQuery({
    queryKey: ['finance', 'cashflow', cfHorizon, cashHistQ.dataUpdatedAt],
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

  const aging = arSummaryQ.data?.aging ?? { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 }
  const arSummary = arSummaryQ.data ?? { invoiced: 0, collected: 0, outstanding: 0, count: 0, aging }

  const invoiceRows = invoicesQ.data?.items ?? []
  const invoiceTotal = invoicesQ.data?.total ?? 0
  const invoiceTotalPages = Math.max(1, Math.ceil(invoiceTotal / INVOICES_PAGE_SIZE))

  async function exportInvoicesCsv() {
    setExportingInvoices(true)
    try {
      const all: InvoiceRow[] = []
      let page = 1
      while (true) {
        const res = await api.get<InvoiceList>(`/invoices?${invoiceListQuery(invFilter, page, EXPORT_PAGE_SIZE)}`)
        all.push(...res.items)
        if (!res.hasMore || res.items.length === 0 || all.length >= res.total) break
        page += 1
      }
      downloadCsv(
        `invoices-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Invoice', 'Order', 'Customer', 'Issued', 'Total', 'Paid', 'Balance', 'Status'],
        all.map((inv) => [
          inv.invoiceNumber,
          inv.orderId,
          inv.customerId,
          new Date(inv.issuedAt).toLocaleDateString(),
          inv.totalAmount,
          inv.amountPaid ?? 0,
          inv.balance,
          inv.displayStatus,
        ]),
      )
    } finally {
      setExportingInvoices(false)
    }
  }

  const filteredBills = useMemo(() => {
    const rows = billsQ.data ?? []
    return rows.filter((bill) => {
      if (apFilter === 'ALL') return bill.balance > 0.01 || Number(bill.amountPaid ?? 0) > 0
      if (apFilter === 'MATCHED' || apFilter === 'EXCEPTION' || apFilter === 'PENDING') {
        return (bill.matchStatus ?? 'PENDING') === apFilter
      }
      return bill.displayStatus === apFilter
    })
  }, [billsQ.data, apFilter])

  const payOrderMut = useMutation({
    mutationFn: async () => {
      if (!payOrder) return
      await api.post(`/orders/${payOrder.orderId}/payments`, {
        amount: parseFloat(payAmount),
        method: payMethod,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'invoices-ar'] })
      void qc.invalidateQueries({ queryKey: ['finance', 'invoices-ar-summary'] })
      setPayOrder(null)
      setPayAmount('')
    },
  })

  const payBillMut = useMutation({
    mutationFn: async () => {
      if (!payBill) return
      await api.post(`/bills/${payBill.id}/payments`, {
        amount: parseFloat(payAmount),
        method: payMethod,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'bills-ap'] })
      setPayBill(null)
      setPayAmount('')
    },
  })

  const reconcileMut = useMutation({
    mutationFn: (lineId: string) => api.post(`/bank-accounts/${lineId}/reconcile`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'bank-summary'] })
      void qc.invalidateQueries({ queryKey: ['finance', 'bank-unreconciled'] })
    },
  })

  const matchBillMut = useMutation({
    mutationFn: (billId: string) => api.post<BillRow>(`/bills/${encodeURIComponent(billId)}/match`, {}),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ['finance', 'bills-ap'] })
      setMatchBill(updated)
    },
  })

  function exportTrialCsv() {
    const rows = trialQ.data ?? []
    downloadCsv(
      `pleros-trial-balance-${year}-${String(month).padStart(2, '0')}.csv`,
      ['Account Code', 'Account Name', 'Type', 'Debits', 'Credits', 'Net'],
      rows.map((r) => [r.accountCode, r.accountName, r.type, r.debits, r.credits, r.netBalance]),
    )
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
        <h1 className="text-2xl font-bold text-pleros-white" style={{ fontFamily: 'var(--font-display)' }}>
          Finance
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>
          AR (invoices), AP (vendor bills), bank reconciliation, trial balance, and cash outlook
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['invoices', 'bills', 'bank', 'trial', 'cashflow'] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setTab(id)}
          >
            {id === 'invoices'
              ? 'Invoices (AR)'
              : id === 'bills'
                ? 'Bills (AP)'
                : id === 'bank'
                  ? 'Bank recon'
                  : id === 'trial'
                    ? 'Trial balance'
                    : 'Cash flow'}
          </button>
        ))}
      </div>

      {tab !== 'trial' && (
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-pleros-border bg-pleros-surface-2/40 text-xs">
          <span className="font-semibold text-pleros-white">Date Range Filter:</span>
          <label className="flex items-center gap-1.5 text-pleros-muted">
            From:
            <input
              type="date"
              className="rounded bg-pleros-surface border border-pleros-border px-2 py-1 text-xs text-pleros-text"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1.5 text-pleros-muted">
            To:
            <input
              type="date"
              className="rounded bg-pleros-surface border border-pleros-border px-2 py-1 text-xs text-pleros-text"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          {(startDate || endDate) && (
            <button
              type="button"
              className="text-xs text-red-400 hover:underline ml-1"
              onClick={() => {
                setStartDate('')
                setEndDate('')
              }}
            >
              Clear dates
            </button>
          )}
        </div>
      )}

      {tab === 'invoices' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'Total invoiced', v: arSummary.invoiced, hint: `${arSummary.count} invoices` },
              { label: 'Collected', v: arSummary.collected, hint: 'Payments received' },
              { label: 'Outstanding AR', v: arSummary.outstanding, hint: 'Unpaid balance' },
            ].map((c) => (
              <div key={c.label} className="pleros-card">
                <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>{c.label}</div>
                <div className="text-xl font-mono font-semibold mt-2" style={{ color: 'var(--c-heading)' }}>{money(c.v)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>{c.hint}</div>
              </div>
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
            Aging buckets below show <strong>outstanding</strong> balance by days since issue — not total invoiced.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { k: 'current', label: 'Current (0–30d)', v: aging.current, color: 'var(--c-success)' },
              { k: 'd30', label: '31–60 Days', v: aging.d30, color: 'var(--c-warning)' },
              { k: 'd60', label: '61–90 Days', v: aging.d60, color: '#ea580c' },
              { k: 'd90', label: '91–120 Days', v: aging.d90, color: 'var(--c-danger)' },
              { k: 'd90p', label: '120+ Days', v: aging.d90p, color: '#b91c1c' },
            ].map((c) => (
              <div key={c.k} className="pleros-card metric-accent" style={{ borderLeftColor: c.color }}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>{c.label}</div>
                <div className="text-lg font-mono font-semibold mt-2" style={{ color: 'var(--c-heading)' }}>{money(c.v)}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-2">
            {['ALL', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'FAILED'].map((s) => (
              <button
                key={s}
                type="button"
                className={invFilter === s ? 'btn-primary' : 'btn-ghost'}
                onClick={() => {
                  setInvFilter(s)
                  setInvoicePage(1)
                }}
              >
                {s}
              </button>
            ))}
            </div>
            <button
              type="button"
              className="btn-ghost"
              disabled={exportingInvoices}
              onClick={() => void exportInvoicesCsv()}
            >
              {exportingInvoices ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
          <div className="pleros-card overflow-x-auto">
            {invoicesQ.isLoading ? <div className="skeleton h-40 w-full" /> : invoicesQ.isError ? (
              <p style={{ color: 'var(--c-danger)' }}>Could not load invoices</p>
            ) : invoiceRows.length === 0 ? (
              <EmptyState icon="📄" title="No invoices" description="Invoices are issued when orders ship." />
            ) : (
              <table className="pleros-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
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
                  {invoiceRows.map((inv) => (
                    <tr key={inv.id}>
                      <td className="font-mono text-xs">{inv.invoiceNumber}</td>
                      <td className="font-mono text-xs">{inv.orderId.slice(0, 12)}…</td>
                      <td>{inv.customerId.slice(0, 12)}…</td>
                      <td className="text-sm" style={{ color: 'var(--c-text-2)' }}>{new Date(inv.issuedAt).toLocaleDateString()}</td>
                      <td className="font-mono">{money(Number(inv.totalAmount))}</td>
                      <td className="font-mono">{money(Number(inv.amountPaid ?? 0))}</td>
                      <td className="font-mono">{money(inv.balance)}</td>
                      <td><StatusBadge status={inv.displayStatus} /></td>
                      <td className="space-x-2">
                        {inv.balance > 0.01 && inv.order?.status !== 'CANCELLED' && inv.order?.status !== 'FAILED' && (
                          <button type="button" className="btn-primary !py-1 !px-2 !text-xs" onClick={() => {
                            setPayOrder(inv)
                            setPayAmount(String(inv.balance.toFixed(2)))
                          }}>Record payment</button>
                        )}
                        <Link to={adminPath(`/orders/${inv.orderId}`)} className="text-sm" style={{ color: 'var(--c-accent)' }}>View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {invoiceTotal > INVOICES_PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--c-text-2)' }}>
              <span>
                Page {invoicePage} of {invoiceTotalPages} · {invoiceTotal} invoice{invoiceTotal === 1 ? '' : 's'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost !py-1 !px-3 !text-xs"
                  disabled={invoicePage <= 1 || invoicesQ.isFetching}
                  onClick={() => setInvoicePage((p) => Math.max(1, p - 1))}
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  className="btn-ghost !py-1 !px-3 !text-xs"
                  disabled={invoicePage >= invoiceTotalPages || invoicesQ.isFetching}
                  onClick={() => setInvoicePage((p) => Math.min(invoiceTotalPages, p + 1))}
                >
                  Next →
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {tab === 'bills' && (
        <>
          <div className="flex flex-wrap gap-2">
            {['ALL', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'MATCHED', 'EXCEPTION', 'PENDING'].map((s) => (
              <button key={s} type="button" className={apFilter === s ? 'btn-primary' : 'btn-ghost'} onClick={() => setApFilter(s)}>
                {s.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <div className="pleros-card overflow-x-auto">
            {billsQ.isLoading ? <div className="skeleton h-40 w-full" /> : billsQ.isError ? (
              <p style={{ color: 'var(--c-danger)' }}>Could not load vendor bills</p>
            ) : filteredBills.length === 0 ? (
              <EmptyState icon="📥" title="No bills" description="Vendor bills are created when goods are received against POs." />
            ) : (
              <table className="pleros-table">
                <thead>
                  <tr>
                    <th>Bill #</th>
                    <th>Supplier</th>
                    <th>Issue</th>
                    <th>Due</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Status</th>
                    <th>3-way match</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredBills.map((bill) => (
                    <tr key={bill.id}>
                      <td className="font-mono">{bill.billNumber}</td>
                      <td>{bill.supplier.name}</td>
                      <td className="text-sm" style={{ color: 'var(--c-text-2)' }}>{new Date(bill.issuedAt).toLocaleDateString()}</td>
                      <td className="text-sm" style={{ color: 'var(--c-text-2)' }}>{bill.dueAt ? new Date(bill.dueAt).toLocaleDateString() : '—'}</td>
                      <td className="font-mono">{money(Number(bill.totalAmount))}</td>
                      <td className="font-mono">{money(Number(bill.amountPaid ?? 0))}</td>
                      <td className="font-mono">{money(bill.balance)}</td>
                      <td><StatusBadge status={bill.displayStatus} /></td>
                      <td>
                        {bill.purchaseOrderId ? (
                          <div className="flex flex-col gap-0.5">
                            <button
                              type="button"
                              className="btn-ghost !py-0.5 !px-1.5 !text-xs text-left"
                              onClick={() => setMatchBill(bill)}
                            >
                              <StatusBadge status={bill.matchStatus ?? 'PENDING'} />
                            </button>
                            {bill.matchStatus === 'EXCEPTION' && bill.matchNotes && (
                              <span className="text-[10px] text-amber-400 max-w-[140px] truncate" title={bill.matchNotes}>
                                ⚠️ {bill.matchNotes}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-pleros-text-3">—</span>
                        )}
                      </td>
                      <td className="space-x-2 whitespace-nowrap">
                        {bill.balance > 0.01 && (
                          <button type="button" className="btn-primary !py-1 !px-2 !text-xs" onClick={() => {
                            setPayBill(bill)
                            setPayAmount(String(bill.balance.toFixed(2)))
                          }}>Mark paid</button>
                        )}
                        {bill.purchaseOrderId ? (
                          <Link to={adminPath(`/purchasing/${bill.purchaseOrderId}`)} style={{ color: 'var(--c-accent)' }}>View PO</Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'bank' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="pleros-card">
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Opening Balance</div>
              <div className="text-xl font-mono font-semibold mt-2" style={{ color: 'var(--c-heading)' }}>
                {money(bankSummaryQ.data?.openingBalanceTotal ?? 0)}
              </div>
            </div>
            <div className="pleros-card">
              <div className="text-[10px] uppercase tracking-wider text-emerald-400">Total Debits (+)</div>
              <div className="text-xl font-mono font-semibold mt-2 text-emerald-400">
                {money(bankSummaryQ.data?.totalDebits ?? 0)}
              </div>
            </div>
            <div className="pleros-card">
              <div className="text-[10px] uppercase tracking-wider text-amber-400">Total Credits (-)</div>
              <div className="text-xl font-mono font-semibold mt-2 text-amber-400">
                {money(bankSummaryQ.data?.totalCredits ?? 0)}
              </div>
            </div>
            <div className="pleros-card metric-accent" style={{ borderLeftColor: 'var(--c-warning)' }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>Unreconciled items</div>
              <div className="text-xl font-mono font-semibold mt-2" style={{ color: 'var(--c-heading)' }}>
                {bankSummaryQ.data?.unreconciledCount ?? 0}
              </div>
            </div>
          </div>

          <div className="flex gap-2 border-b border-pleros-border pb-2 text-xs">
            {(['summary', 'debits', 'credits', 'unreconciled'] as const).map((st) => (
              <button
                key={st}
                type="button"
                className={`px-3 py-1.5 rounded-md font-medium capitalize transition-colors ${
                  bankSubTab === st
                    ? 'bg-pleros-primary text-white'
                    : 'text-pleros-muted hover:bg-pleros-surface-2'
                }`}
                onClick={() => setBankSubTab(st)}
              >
                {st === 'summary'
                  ? 'All Transactions'
                  : st === 'debits'
                    ? 'Debit Transactions (+)'
                    : st === 'credits'
                      ? 'Credit Transactions (-)'
                      : 'Unreconciled Items'}
              </button>
            ))}
          </div>

          <div className="pleros-card overflow-x-auto">
            {bankLinesQ.isLoading ? <div className="skeleton h-40 w-full" /> : (bankLinesQ.data ?? []).length === 0 ? (
              <EmptyState icon="🏦" title="No transactions" description="No statement lines match the selected sub-tab or date filter." />
            ) : (
              <table className="pleros-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Account</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Type</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(bankLinesQ.data ?? []).map((line) => {
                    const amt = Number(line.amount)
                    return (
                      <tr key={line.id}>
                        <td>{new Date(line.postedAt).toLocaleDateString()}</td>
                        <td>{line.bankAccount?.name ?? '—'}</td>
                        <td>{line.description}</td>
                        <td className={`font-mono font-medium ${amt >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {money(amt)}
                        </td>
                        <td>
                          <span className={`text-xs px-2 py-0.5 rounded font-mono ${amt >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                            {amt >= 0 ? 'DEBIT (+)' : 'CREDIT (-)'}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-primary !py-1 !px-2 !text-xs"
                            disabled={reconcileMut.isPending}
                            onClick={() => reconcileMut.mutate(line.id)}
                          >
                            Reconcile
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'trial' && (
        <div className="pleros-card space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <label className="text-sm font-medium" style={{ color: 'var(--c-text-2)' }}>View Period:</label>
            <select
              className="pleros-input max-w-[130px]"
              value={trialPeriodType}
              onChange={(e) => setTrialPeriodType(e.target.value as 'MONTHLY' | 'QUARTERLY' | 'YEARLY')}
            >
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="YEARLY">Yearly</option>
            </select>

            {trialPeriodType === 'MONTHLY' && (
              <>
                <label className="text-sm" style={{ color: 'var(--c-text-2)' }}>Month</label>
                <select className="pleros-input max-w-[120px]" value={month} onChange={(e) => setMonth(+e.target.value)}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString('default', { month: 'short' })}</option>
                  ))}
                </select>
              </>
            )}

            {trialPeriodType === 'QUARTERLY' && (
              <>
                <label className="text-sm" style={{ color: 'var(--c-text-2)' }}>Quarter</label>
                <select className="pleros-input max-w-[100px]" value={quarter} onChange={(e) => setQuarter(+e.target.value)}>
                  {[1, 2, 3, 4].map((q) => (
                    <option key={q} value={q}>Q{q}</option>
                  ))}
                </select>
              </>
            )}

            <label className="text-sm" style={{ color: 'var(--c-text-2)' }}>Year</label>
            <select className="pleros-input max-w-[100px]" value={year} onChange={(e) => setYear(+e.target.value)}>
              {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="button" className="btn-ghost" onClick={() => void trialQ.refetch()}>Load</button>
            <button type="button" className="btn-primary" onClick={exportTrialCsv} disabled={!(trialQ.data?.length)}>Export CSV</button>
          </div>
          {trialQ.isLoading ? <div className="skeleton h-48 w-full" /> : trialQ.isError ? (
            <p style={{ color: 'var(--c-danger)' }}>Could not load trial balance</p>
          ) : (trialQ.data?.length ?? 0) === 0 ? (
            <EmptyState icon="📊" title="No posted journals" description="Post journal entries for this period to see balances." />
          ) : (
            <table className="pleros-table">
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
          <div className="pleros-card">
            {cashHistQ.isLoading || (!cashInput && cashHistQ.isFetching) ? (
              <div className="skeleton h-64 w-full" />
            ) : !cashInput ? (
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                Need at least three weeks of AR/AP activity (or KPI revenue) to forecast cashflow.
              </p>
            ) : cashQ.isLoading ? (
              <div className="skeleton h-64 w-full" />
            ) : cashQ.isError ? (
              <p style={{ color: 'var(--c-danger)' }}>{cashQ.error instanceof Error ? cashQ.error.message : 'Error'}</p>
            ) : (
              <>
                <p className="text-sm mb-1" style={{ color: 'var(--c-text-3)' }}>
                  Weekly EWMA forecast
                  {cashQ.data?.method ? (
                    <span className="font-mono text-xs ml-2" style={{ color: 'var(--c-accent)' }}>
                      {cashQ.data.method}
                    </span>
                  ) : null}
                  {cashHistQ.data?.source ? (
                    <span className="text-xs ml-2">
                      · source {cashHistQ.data.source === 'ar_ap' ? 'AR/AP collections' : 'revenue proxy'}
                    </span>
                  ) : null}
                </p>
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
                        contentStyle={{
                          background: 'var(--c-surface-2)',
                          border: '1px solid var(--c-border)',
                          borderRadius: 8,
                          color: 'var(--c-heading)',
                        }}
                        labelStyle={{ color: 'var(--c-text-2)' }}
                        itemStyle={{ color: 'var(--c-heading)' }}
                        formatter={(v: number) => [money(v), 'Closing']}
                      />
                      <Area type="monotone" dataKey="closing" stroke="var(--c-primary)" fill="url(#cfPos)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {[...(cashHistQ.data?.warnings ?? []), ...(cashQ.data?.warnings ?? [])].length > 0 && (
                  <ul className="mt-4 text-xs text-amber-400 list-disc pl-5">
                    {[...(cashHistQ.data?.warnings ?? []), ...(cashQ.data?.warnings ?? [])].map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {(payOrder || payBill) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }}>
          <div className="pleros-card max-w-md w-full space-y-4">
            <h3 style={{ color: 'var(--c-heading)', fontFamily: 'var(--font-display)' }}>Record payment</h3>
            <label className="block text-sm" style={{ color: 'var(--c-text-2)' }}>Amount</label>
            <input className="pleros-input" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            <label className="block text-sm" style={{ color: 'var(--c-text-2)' }}>Method</label>
            <select className="pleros-input" value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}>
              {(['CASH', 'CHECK', 'ACH', 'CARD'] as const).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-ghost" onClick={() => { setPayOrder(null); setPayBill(null) }}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                disabled={payOrderMut.isPending || payBillMut.isPending}
                onClick={() => {
                  if (payOrder) void payOrderMut.mutate()
                  else void payBillMut.mutate()
                }}
              >Submit</button>
            </div>
          </div>
        </div>
      )}

      {matchBill ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={() => setMatchBill(null)}>
          <div className="pleros-card max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start gap-3">
              <div>
                <h3 style={{ color: 'var(--c-heading)', fontFamily: 'var(--font-display)', margin: 0 }}>3-way match</h3>
                <p className="font-mono text-sm mt-1" style={{ color: 'var(--c-accent)' }}>{matchBill.billNumber}</p>
              </div>
              <StatusBadge status={matchBill.matchStatus ?? 'PENDING'} />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt style={{ color: 'var(--c-text-3)' }}>PO total</dt>
                <dd className="font-mono">{matchBill.poTotal != null ? money(Number(matchBill.poTotal)) : '—'}</dd>
              </div>
              <div>
                <dt style={{ color: 'var(--c-text-3)' }}>Received total</dt>
                <dd className="font-mono">{matchBill.receivedTotal != null ? money(Number(matchBill.receivedTotal)) : '—'}</dd>
              </div>
              <div>
                <dt style={{ color: 'var(--c-text-3)' }}>Bill total</dt>
                <dd className="font-mono">{money(Number(matchBill.totalAmount))}</dd>
              </div>
              <div>
                <dt style={{ color: 'var(--c-text-3)' }}>Balance due</dt>
                <dd className="font-mono">{money(matchBill.balance)}</dd>
              </div>
            </dl>
            {matchBill.matchNotes ? (
              <p className="text-sm rounded-lg p-3" style={{ background: 'var(--c-surface-2)', color: 'var(--c-warning)' }}>
                {matchBill.matchNotes}
              </p>
            ) : matchBill.matchStatus === 'MATCHED' ? (
              <p className="text-sm" style={{ color: 'var(--c-success)' }}>Bill quantities and amounts match received goods on the PO.</p>
            ) : null}
            <div className="flex flex-wrap gap-2 justify-end">
              {matchBill.purchaseOrderId ? (
                <Link to={adminPath(`/purchasing/${matchBill.purchaseOrderId}`)} className="btn-ghost !text-sm">
                  View PO
                </Link>
              ) : null}
              <button type="button" className="btn-ghost" onClick={() => setMatchBill(null)}>
                Close
              </button>
              {matchBill.purchaseOrderId ? (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={matchBillMut.isPending}
                  onClick={() => matchBillMut.mutate(matchBill.id)}
                >
                  {matchBillMut.isPending ? 'Running…' : 'Re-run match'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
