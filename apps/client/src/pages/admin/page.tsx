import { Link } from 'react-router-dom'
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
import { api } from '@/lib/api-admin'
import {
  BentoAvatarStack,
  BentoDonut,
  BentoHeroCard,
  BentoMetricCard,
  BentoTrendPill,
} from '@/components/cosmos/bento-cards'
import { LowStockAlert } from '@/components/inventory/low-stock-alert'
import { RecentOrders } from '@/components/orders/recent-orders'
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

const CHART_GRID = '#e2e8f0'
const CHART_AXIS = '#94a3b8'
const CHART_LINE = '#6366f1'
const CHART_FILL = '#6366f1'

function sumNetWeeks(forecast: CashflowBucket[], weeks: number): number {
  let s = 0
  for (let i = 0; i < Math.min(weeks, forecast.length); i++) s += forecast[i]?.projected_net ?? 0
  return s
}

function horizonWeeks(days: number): number {
  return Math.max(1, Math.ceil(days / 7))
}

function fmtCurrency(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function fmtNumber(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US').format(n)
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

  const sortedSnapshots = useMemo(
    () =>
      [...(snapshotsQ.data ?? [])].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      ),
    [snapshotsQ.data],
  )

  const chartData = useMemo(
    () =>
      sortedSnapshots.slice(-30).map((r) => ({
        label: new Date(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        revenue: Number(r.revenue),
        orders: r.ordersCount,
      })),
    [sortedSnapshots],
  )

  const revenueSpark = chartData.slice(-8).map((d) => d.revenue)
  const ordersSpark = chartData.slice(-8).map((d) => d.orders)

  const cashflowInput = useMemo(() => {
    if (sortedSnapshots.length < 3) return null
    const tail = sortedSnapshots.slice(-20)
    const tenantId = tail[tail.length - 1]?.tenantId ?? 'tenant'
    const history = tail.map((s) => ({
      period: new Date(s.date).toISOString().slice(0, 10),
      inflow: Number(s.revenue),
      outflow: Math.max(0, Number(s.revenue) * 0.55),
    }))
    return { tenant_id: tenantId, history, horizon_weeks: 13 }
  }, [sortedSnapshots])

  const cashflowQ = useQuery<CashflowResponse>({
    queryKey: ['dashboard', 'cashflow', cashflowInput?.tenant_id, sortedSnapshots.length],
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

  const kpis = kpisQ.data
  const picked = kpis?.itemsPicked ?? 0
  const open = kpis?.openOrders ?? 0
  const fulfillmentPct = picked + open > 0 ? (picked / (picked + open)) * 100 : 0
  const lowStockCount = alertsQ.data?.lowStock?.length ?? 0

  return (
    <div className="bento-page space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap px-1">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] font-semibold" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Dashboard
          </p>
          <h2 className="text-2xl font-bold tracking-tight mt-1" style={{ color: 'var(--c-on-dark)' }}>
            Good to see you
          </h2>
        </div>
        <span className="subtle-chip">Live · 30s refresh</span>
      </div>

      {kpisQ.isError && (
        <div className="alert-danger">
          Could not load KPIs: {kpisQ.error instanceof Error ? kpisQ.error.message : 'Unknown error'}
        </div>
      )}

      <div className="bento-grid">
        <div className="bento-span-5 bento-row-2">
          <BentoHeroCard
            className="h-full"
            title="Your distribution command center"
            subtitle="Revenue, orders, inventory, and compliance in one calm workspace."
          >
            <BentoAvatarStack labels={['Ops', 'Sales', 'WH', 'Fin']} />
          </BentoHeroCard>
        </div>

        {kpisQ.isLoading ? (
          <>
            <div className="bento-cell bento-tone-muted bento-span-2 skeleton min-h-[148px]" />
            <div className="bento-cell bento-tone-white bento-span-2 skeleton min-h-[148px]" />
            <div className="bento-cell bento-tone-white bento-span-3 skeleton min-h-[148px]" />
          </>
        ) : (
          <>
            <div className="bento-span-2">
              <BentoMetricCard
                label="Revenue today"
                value={fmtCurrency(kpis?.todayRevenue)}
                trend={kpis?.revenueTrend}
                sparkline={revenueSpark}
                tone="muted"
              />
            </div>
            <div className="bento-span-2">
              <BentoMetricCard
                label="Open orders"
                value={fmtNumber(kpis?.openOrders)}
                trend={kpis?.ordersTrend}
                sparkline={ordersSpark}
                tone="white"
              />
            </div>
            <div className="bento-span-3">
              <BentoMetricCard
                label="Items picked"
                value={fmtNumber(kpis?.itemsPicked)}
                tone="muted"
              />
            </div>
          </>
        )}

        <div className="bento-cell bento-tone-white bento-span-3">
          <BentoDonut
            percent={fulfillmentPct}
            label="Pick completion"
            sublabel={`${fmtNumber(picked)} picked · ${fmtNumber(open)} open`}
          />
        </div>

        <div className="bento-cell bento-tone-white bento-span-4 flex flex-col">
          <h3 className="bento-section-title">Cash outlook</h3>
          <p className="bento-section-sub">Projected net balance</p>
          {cashflowQ.isLoading && <div className="skeleton h-28 w-full mt-4" />}
          {!cashflowQ.isLoading && !cashflowQ.isError && !forecastBalances && (
            <div className="empty-note mt-4">Need at least three KPI snapshots to forecast cash.</div>
          )}
          {forecastBalances && (
            <dl className="grid grid-cols-1 gap-2 mt-4 flex-1">
              {[
                { label: '30 days', v: forecastBalances.b30 },
                { label: '60 days', v: forecastBalances.b60 },
                { label: '90 days', v: forecastBalances.b90 },
              ].map(({ label, v }) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-2xl px-4 py-3"
                  style={{ background: 'var(--c-surface-2)' }}
                >
                  <dt className="text-sm font-semibold" style={{ color: 'var(--c-text-2)' }}>
                    {label}
                  </dt>
                  <dd className="font-mono text-sm font-bold" style={{ color: v < 0 ? 'var(--c-danger)' : 'var(--c-heading)' }}>
                    {fmtCurrency(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="bento-cell bento-tone-white bento-span-8 bento-row-2 min-h-[400px]">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="bento-section-title">Revenue trend</h3>
              <p className="bento-section-sub">Last 30 days</p>
            </div>
            {kpis?.revenueTrend != null ? <BentoTrendPill value={kpis.revenueTrend} /> : null}
          </div>
          {snapshotsQ.isLoading ? (
            <div className="skeleton h-[300px] w-full mt-5" />
          ) : chartData.length === 0 ? (
            <div className="empty-note mt-5">Not enough history to chart revenue yet.</div>
          ) : (
            <div className="h-[300px] w-full mt-5">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_FILL} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={CHART_FILL} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 4" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: CHART_AXIS, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: CHART_AXIS, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                    tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      color: '#0f172a',
                      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
                    }}
                    formatter={(value: number) => [`$${value.toLocaleString()}`, 'Revenue']}
                  />
                  <Area type="monotone" dataKey="revenue" stroke={CHART_LINE} fill="url(#revFill)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bento-span-4 bento-row-2 flex flex-col gap-4">
          <div className="bento-cell bento-tone-muted flex-1">
            <LowStockAlert alerts={alertsQ.data?.lowStock ?? []} />
          </div>

          <div className="bento-cell bento-tone-white flex flex-col justify-between min-h-[140px]">
            <div>
              <p className="bento-kpi-label">Compliance</p>
              <div className="mt-3">
                {kpis?.msaStatus ? <StatusBadge status={kpis.msaStatus} /> : <span style={{ color: 'var(--c-text-3)' }}>—</span>}
              </div>
            </div>
            <Link to="/admin/compliance" className="bento-link text-sm mt-4 inline-flex items-center gap-1">
              Open compliance →
            </Link>
          </div>
        </div>

        <div className="bento-cell bento-tone-white bento-span-12">
          <RecentOrders />
        </div>
      </div>
    </div>
  )
}
