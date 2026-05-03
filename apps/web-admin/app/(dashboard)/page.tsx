'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { StatsCard } from '@cosmos/ui'
import { api } from '@/lib/api'
import { LowStockAlert } from '@/components/inventory/low-stock-alert'
import { RecentOrders } from '@/components/orders/recent-orders'
import { MSAStatusCard } from '@/components/compliance/msa-status-card'
import { StatusBadge } from '@/components/cosmos/status-badge'

interface Kpis {
  todayRevenue: number
  revenueTrend: number
  openOrders: number
  ordersTrend: number
  itemsPicked: number
  msaStatus: string
}

interface KpiSnapshot {
  tenantId: string
  date: string
  revenue: string | number
  ordersCount: number
}

interface CashflowBucket {
  label: string
  projected_net: number
  projected_inflow: number
  projected_outflow: number
}

interface CashflowResponse {
  tenant_id: string
  weekly_net_baseline: number
  forecast: CashflowBucket[]
  warnings: string[]
}

function sumNetWeeks(forecast: CashflowBucket[], weeks: number): number {
  let s = 0
  for (let i = 0; i < Math.min(weeks, forecast.length); i++) s += forecast[i]?.projected_net ?? 0
  return s
}

function horizonWeeks(days: number): number {
  return Math.max(1, Math.ceil(days / 7))
}

export default function DashboardPage() {
  const kpisQ = useQuery<Kpis>({
    queryKey: ['dashboard', 'kpis'],
    queryFn: () => api.get<Kpis>('/analytics/kpis'),
    refetchInterval: 30_000,
  })

  const snapshotsQ = useQuery<KpiSnapshot[]>({
    queryKey: ['dashboard', 'kpi-snapshots'],
    queryFn: () => api.get<KpiSnapshot[]>('/kpi/snapshots'),
    refetchInterval: 30_000,
  })

  const alertsQ = useQuery<{
    lowStock: { skuId: string; name: string; available: number; reorderPoint?: number }[]
  }>({
    queryKey: ['dashboard', 'alerts'],
    queryFn: () => api.get('/inventory/alerts'),
    refetchInterval: 30_000,
  })

  const chartData = useMemo(() => {
    const rows = [...(snapshotsQ.data ?? [])].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    )
    const last30 = rows.slice(-30)
    return last30.map((r) => ({
      label: new Date(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      revenue: Number(r.revenue),
    }))
  }, [snapshotsQ.data])

  const cashflowInput = useMemo(() => {
    const rows = [...(snapshotsQ.data ?? [])].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    )
    if (rows.length < 3) return null
    const tail = rows.slice(-20)
    const tenantId = tail[tail.length - 1]?.tenantId ?? 'tenant'
    const history = tail.map((s) => {
      const inflow = Number(s.revenue)
      return {
        period: new Date(s.date).toISOString().slice(0, 10),
        inflow,
        outflow: Math.max(0, inflow * 0.55),
      }
    })
    return { tenant_id: tenantId, history, horizon_weeks: 13 }
  }, [snapshotsQ.data])

  const cashflowQ = useQuery<CashflowResponse>({
    queryKey: ['dashboard', 'cashflow', cashflowInput?.tenant_id, (snapshotsQ.data ?? []).length],
    enabled: !!cashflowInput,
    queryFn: async () => {
      const res = await fetch('/api/cashflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cashflowInput),
      })
      const j = (await res.json()) as CashflowResponse & { message?: string }
      if (!res.ok) throw new Error(j.message ?? 'Cashflow forecast failed')
      return j
    },
    refetchInterval: 30_000,
  })

  const forecastBalances = useMemo(() => {
    const fc = cashflowQ.data?.forecast ?? []
    if (fc.length === 0) return null
    const histNet =
      cashflowInput?.history.reduce((s, p) => s + (p.inflow - p.outflow), 0) ??
      cashflowQ.data?.weekly_net_baseline ??
      0
    const opening = histNet
    return {
      b30: opening + sumNetWeeks(fc, horizonWeeks(30)),
      b60: opening + sumNetWeeks(fc, horizonWeeks(60)),
      b90: opening + sumNetWeeks(fc, horizonWeeks(90)),
    }
  }, [cashflowQ.data, cashflowInput])

  const kpisLoading = kpisQ.isLoading
  const kpisError = kpisQ.isError

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-cosmos-white font-display">Command Center</h1>
          <p className="text-cosmos-text-3 text-sm mt-1">Real-time operations overview</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-cosmos-text-3">Live · 30s refresh</span>
        </div>
      </div>

      {kpisError && (
        <div
          className="cosmos-card border text-sm"
          style={{ borderColor: 'var(--c-danger)', color: 'var(--c-danger)' }}
        >
          Could not load KPIs: {kpisQ.error instanceof Error ? kpisQ.error.message : 'Unknown error'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {kpisLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="cosmos-card">
                <div className="skeleton h-4 w-24 mb-3" />
                <div className="skeleton h-8 w-full" />
              </div>
            ))}
          </>
        ) : (
          <>
            <StatsCard
              label="Today's Revenue"
              value={kpisQ.data?.todayRevenue ?? null}
              format="currency"
              trend={kpisQ.data?.revenueTrend}
            />
            <StatsCard
              label="Open Orders"
              value={kpisQ.data?.openOrders ?? null}
              format="number"
              trend={kpisQ.data?.ordersTrend}
            />
            <StatsCard label="Items Picked Today" value={kpisQ.data?.itemsPicked ?? null} format="number" />
            <div className="cosmos-card">
              <div className="text-xs uppercase tracking-wider text-cosmos-text-3">MSA status</div>
              <div className="mt-3">
                {kpisQ.data?.msaStatus ? <StatusBadge status={kpisQ.data.msaStatus} /> : <span className="text-cosmos-text-3">—</span>}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="cosmos-card">
            <h3 className="text-cosmos-white font-semibold text-base font-display">Revenue (30 days)</h3>
            <p className="text-xs mt-1 text-cosmos-text-3">Daily totals from analytics snapshots</p>
            {snapshotsQ.isLoading ? (
              <div className="skeleton h-[280px] w-full mt-4" />
            ) : chartData.length === 0 ? (
              <p className="mt-8 text-sm text-center text-cosmos-text-3 py-12">Not enough history to chart revenue yet.</p>
            ) : (
              <div className="h-[280px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--c-primary)" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="var(--c-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" />
                    <XAxis dataKey="label" tick={{ fill: 'var(--c-text-3)', fontSize: 11 }} axisLine={{ stroke: 'var(--c-border)' }} />
                    <YAxis
                      tick={{ fill: 'var(--c-text-3)', fontSize: 11 }}
                      axisLine={{ stroke: 'var(--c-border)' }}
                      tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--c-surface-2)',
                        border: '1px solid var(--c-border)',
                        borderRadius: 10,
                        color: 'var(--c-text)',
                      }}
                      formatter={(value: number) => [`$${value.toLocaleString()}`, 'Revenue']}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="var(--c-primary)" fill="url(#revFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <RecentOrders />
        </div>

        <div className="space-y-4">
          <div className="cosmos-card">
            <h3 className="text-cosmos-white font-semibold text-base font-display">Cash flow outlook</h3>
            <p className="text-xs mt-1 text-cosmos-text-3">EWMA model from KPI history (via cashflow service)</p>
            {cashflowQ.isLoading && <div className="skeleton h-24 w-full mt-4" />}
            {cashflowQ.isError && (
              <p className="mt-4 text-sm" style={{ color: 'var(--c-danger)' }}>
                {cashflowQ.error instanceof Error ? cashflowQ.error.message : 'Forecast unavailable'}
              </p>
            )}
            {!cashflowQ.isLoading && !cashflowQ.isError && !forecastBalances && (
              <p className="mt-4 text-sm text-cosmos-text-3">Need at least three KPI snapshots to run a forecast.</p>
            )}
            {forecastBalances && (
              <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                {[
                  { label: '30d', v: forecastBalances.b30 },
                  { label: '60d', v: forecastBalances.b60 },
                  { label: '90d', v: forecastBalances.b90 },
                ].map(({ label, v }) => (
                  <div key={label} className="rounded-lg p-3" style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
                    <dt className="text-[10px] uppercase tracking-wider text-cosmos-text-3">Proj. balance</dt>
                    <dd className="mt-1 font-mono text-sm font-semibold" style={{ color: v < 0 ? 'var(--c-danger)' : 'var(--c-accent)' }}>
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)}
                    </dd>
                    <dd className="text-[10px] text-cosmos-text-3 mt-0.5">{label}</dd>
                  </div>
                ))}
              </dl>
            )}
            {(cashflowQ.data?.warnings?.length ?? 0) > 0 && (
              <ul className="mt-3 text-xs text-amber-400 list-disc pl-4">
                {cashflowQ.data!.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>

          <MSAStatusCard />
          <LowStockAlert alerts={alertsQ.data?.lowStock ?? []} />
        </div>
      </div>
    </div>
  )
}
