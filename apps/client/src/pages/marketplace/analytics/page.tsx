import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { MarketplaceNav } from '../marketplace-nav'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '@/lib/api-admin'
import { BentoMetricCard } from '@/components/pleros/bento-cards'
import { EmptyState } from '@/components/pleros/empty-state'
import { StatusBadge } from '@/components/pleros/status-badge'

type SellerAnalytics = {
  periodDays: number
  summary: {
    liveListings: number
    soldListings: number
    pendingReviewListings: number
    completedSales: number
    openFulfillment: number
    pendingPayment: number
    cancelledOrders: number
    disputedOrders: number
    grossRevenueCents: number
    netRevenueCents: number
    commissionCents: number
    escrowHeldCents: number
    periodGrossRevenueCents: number
    periodNetRevenueCents: number
    periodCompletedSales: number
    avgOrderValueCents: number
    sellThroughRate: number
    fixedListings: number
    auctionListings: number
    ratingAvg: number
    ratingCount: number
    avgResponseTimeHours: number
  }
  revenueSeries: Array<{ date: string; grossCents: number; netCents: number; orders: number }>
  ordersByStatus: Array<{ status: string; count: number }>
  salesByCategory: Array<{ category: string; orders: number; revenueCents: number }>
  salesByListingType: Array<{ listingType: string; orders: number; revenueCents: number }>
  topListings: Array<{
    listingId: string
    title: string
    listingType: string
    orders: number
    revenueCents: number
  }>
  recentSales: Array<{
    orderId: string
    listingTitle: string
    agreedPriceCents: number
    netCents: number
    orderStatus: string
    createdAt: string
  }>
  recentRatings: Array<{ stars: number; comment: string | null; createdAt: string }>
}

const PERIODS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
] as const

const CHART_GRID = 'var(--c-border, rgba(255, 255, 255, 0.06))'
const CHART_AXIS = 'var(--c-text-3, #71717a)'
const CHART_NET = 'var(--c-accent, #6b9fd4)'
const CHART_GROSS = 'var(--c-primary, #5b8def)'

function money(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function Stars({ value }: { value: number }) {
  return (
    <span className="text-pleros-accent" aria-label={`${value} stars`}>
      {'★'.repeat(value)}
      {'☆'.repeat(Math.max(0, 5 - value))}
    </span>
  )
}

export default function MarketplaceAnalyticsPage() {
  const [periodDays, setPeriodDays] = useState(30)

  const analyticsQ = useQuery({
    queryKey: ['marketplace', 'analytics', 'seller', periodDays],
    queryFn: () => api.get<SellerAnalytics>(`/marketplace/analytics/seller?days=${periodDays}`),
  })

  const data = analyticsQ.data
  const s = data?.summary

  const chartData = useMemo(
    () =>
      (data?.revenueSeries ?? []).map((row) => ({
        date: fmtDate(row.date),
        gross: row.grossCents / 100,
        net: row.netCents / 100,
        orders: row.orders,
      })),
    [data?.revenueSeries],
  )

  const categoryChart = useMemo(
    () =>
      (data?.salesByCategory ?? []).slice(0, 6).map((row) => ({
        name: row.category,
        revenue: row.revenueCents / 100,
        orders: row.orders,
      })),
    [data?.salesByCategory],
  )

  const revenueSparkline = useMemo(
    () => (data?.revenueSeries ?? []).map((row) => row.netCents / 100),
    [data?.revenueSeries],
  )

  const hasSales = (s?.completedSales ?? 0) > 0

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <MarketplaceNav
        title="Seller Analytics"
        subtitle="Revenue, listings, and fulfillment performance for your marketplace sales"
        actions={
          <div className="flex flex-wrap gap-2">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                className={periodDays === p.days ? 'btn-primary !text-sm' : 'btn-ghost !text-sm'}
                onClick={() => setPeriodDays(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {analyticsQ.isLoading && <p className="text-sm text-pleros-text-3">Loading analytics…</p>}
      {analyticsQ.isError && (
        <p className="text-sm text-red-400">Could not load seller analytics. Check marketplace access.</p>
      )}

      {s && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-6">
            <BentoMetricCard
              label={`Net revenue (${periodDays}d)`}
              value={money(s.periodNetRevenueCents)}
              sparkline={revenueSparkline.length > 1 ? revenueSparkline : undefined}
              tone="white"
            />
            <BentoMetricCard label="Completed sales" value={String(s.periodCompletedSales)} tone="muted" />
            <BentoMetricCard label="Live listings" value={String(s.liveListings)} tone="muted" />
            <BentoMetricCard label="Open fulfillment" value={String(s.openFulfillment)} tone="muted" />
            <BentoMetricCard label="Lifetime gross" value={money(s.grossRevenueCents)} tone="muted" />
            <BentoMetricCard label="Lifetime net" value={money(s.netRevenueCents)} tone="muted" />
            <BentoMetricCard label="Escrow held" value={money(s.escrowHeldCents)} tone="muted" />
            <BentoMetricCard label="Avg order value" value={money(s.avgOrderValueCents)} tone="muted" />
          </div>

          <div className="grid gap-4 xl:grid-cols-3 mb-6">
            <section
              className="xl:col-span-2 border rounded-xl p-4"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
            >
              <h2 className="text-sm font-medium text-pleros-white mb-1">Revenue trend</h2>
              <p className="text-xs text-pleros-text-3 mb-4">Net payout after 10% platform commission</p>
              {!hasSales ? (
                <EmptyState icon="📈" title="No completed sales yet" description="Revenue will appear here after your first sale completes." />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: CHART_AXIS, fontSize: 11 }} />
                      <YAxis tick={{ fill: CHART_AXIS, fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--c-surface-2)',
                          border: '1px solid var(--c-border)',
                          borderRadius: 8,
                          color: 'var(--c-heading)',
                        }}
                        labelStyle={{ color: 'var(--c-text-2)' }}
                        itemStyle={{ color: 'var(--c-heading)' }}
                        formatter={(value: number, name: string) => [
                          `$${value.toFixed(2)}`,
                          name === 'net' ? 'Net' : 'Gross',
                        ]}
                      />
                      <Area type="monotone" dataKey="gross" stroke={CHART_GROSS} fill={CHART_GROSS} fillOpacity={0.12} />
                      <Area type="monotone" dataKey="net" stroke={CHART_NET} fill={CHART_NET} fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section
              className="border rounded-xl p-4"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
            >
              <h2 className="text-sm font-medium text-pleros-white mb-4">Trust & listings</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-pleros-text-3">Rating</dt>
                  <dd className="text-pleros-white">
                    ★ {s.ratingAvg.toFixed(1)} ({s.ratingCount})
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-pleros-text-3">Avg response</dt>
                  <dd className="text-pleros-white">
                    {s.avgResponseTimeHours > 0 ? `~${s.avgResponseTimeHours.toFixed(0)}h` : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-pleros-text-3">Sell-through</dt>
                  <dd className="text-pleros-white">{s.sellThroughRate}%</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-pleros-text-3">Sold listings</dt>
                  <dd className="text-pleros-white">{s.soldListings}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-pleros-text-3">Pending review</dt>
                  <dd className="text-pleros-white">{s.pendingReviewListings}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-pleros-text-3">Fixed / auction</dt>
                  <dd className="text-pleros-white">
                    {s.fixedListings} / {s.auctionListings}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-pleros-text-3">Platform fees (lifetime)</dt>
                  <dd className="text-pleros-white">{money(s.commissionCents)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-pleros-text-3">Pending payment</dt>
                  <dd className="text-pleros-white">{s.pendingPayment}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-pleros-text-3">Disputes</dt>
                  <dd className="text-pleros-white">{s.disputedOrders}</dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 mb-6">
            <section
              className="border rounded-xl p-4"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
            >
              <h2 className="text-sm font-medium text-pleros-white mb-4">Sales by category</h2>
              {categoryChart.length === 0 ? (
                <p className="text-sm text-pleros-text-3">No category breakdown yet.</p>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryChart} layout="vertical" margin={{ left: 8, right: 8 }}>
                      <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fill: CHART_AXIS, fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fill: CHART_AXIS, fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--c-surface-2)',
                          border: '1px solid var(--c-border)',
                          borderRadius: 8,
                          color: 'var(--c-heading)',
                        }}
                        labelStyle={{ color: 'var(--c-text-2)' }}
                        itemStyle={{ color: 'var(--c-heading)' }}
                        formatter={(value: number) => [`$${value.toFixed(2)}`, 'Revenue']}
                      />
                      <Bar dataKey="revenue" fill={CHART_NET} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section
              className="border rounded-xl p-4"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
            >
              <h2 className="text-sm font-medium text-pleros-white mb-4">Order pipeline</h2>
              {(data.ordersByStatus ?? []).length === 0 ? (
                <p className="text-sm text-pleros-text-3">No orders yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data.ordersByStatus.map((row) => (
                    <li key={row.status} className="flex items-center justify-between gap-3 text-sm">
                      <StatusBadge status={row.status} />
                      <span className="text-pleros-white font-medium">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}

              {(data.salesByListingType ?? []).length > 0 && (
                <div className="mt-6 pt-4 border-t" style={{ borderColor: 'var(--c-border)' }}>
                  <h3 className="text-xs uppercase tracking-wide text-pleros-text-3 mb-3">By listing type</h3>
                  <ul className="space-y-2 text-sm">
                    {data.salesByListingType.map((row) => (
                      <li key={row.listingType} className="flex justify-between gap-3">
                        <span className="text-pleros-text-3">{row.listingType}</span>
                        <span className="text-pleros-white">
                          {row.orders} · {money(row.revenueCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 mb-6">
            <section
              className="border rounded-xl p-4"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
            >
              <h2 className="text-sm font-medium text-pleros-white mb-4">Top listings</h2>
              {(data.topListings ?? []).length === 0 ? (
                <EmptyState icon="📦" title="No top sellers yet" description="Your best-performing listings will show here." />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-pleros-text-3 border-b" style={{ borderColor: 'var(--c-border)' }}>
                      <th className="pb-2">Listing</th>
                      <th className="pb-2">Orders</th>
                      <th className="pb-2 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topListings.map((row) => (
                      <tr key={row.listingId} className="border-b" style={{ borderColor: 'var(--c-border)' }}>
                        <td className="py-2 pr-2">
                          <Link to={`/admin/marketplace/${row.listingId}`} className="text-pleros-accent hover:underline">
                            {row.title}
                          </Link>
                          <p className="text-xs text-pleros-text-3">{row.listingType}</p>
                        </td>
                        <td className="py-2">{row.orders}</td>
                        <td className="py-2 text-right">{money(row.revenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section
              className="border rounded-xl p-4"
              style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
            >
              <h2 className="text-sm font-medium text-pleros-white mb-4">Recent reviews</h2>
              {(data.recentRatings ?? []).length === 0 ? (
                <p className="text-sm text-pleros-text-3">No buyer ratings yet.</p>
              ) : (
                <ul className="space-y-3">
                  {data.recentRatings.map((r, i) => (
                    <li key={`${r.createdAt}-${i}`} className="text-sm border-b pb-3" style={{ borderColor: 'var(--c-border)' }}>
                      <div className="flex items-center justify-between gap-2">
                        <Stars value={r.stars} />
                        <span className="text-xs text-pleros-text-3">{fmtDate(r.createdAt)}</span>
                      </div>
                      {r.comment ? <p className="text-pleros-text-2 mt-1">{r.comment}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section
            className="border rounded-xl p-4"
            style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-medium text-pleros-white">Recent orders</h2>
              <Link to="/admin/marketplace/orders" className="text-sm text-pleros-accent">
                View all orders →
              </Link>
            </div>
            {(data.recentSales ?? []).length === 0 ? (
              <EmptyState icon="🛒" title="No orders yet" description="Orders you sell will appear here." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-pleros-text-3 border-b" style={{ borderColor: 'var(--c-border)' }}>
                    <th className="pb-2">Listing</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2 text-right">Gross</th>
                    <th className="pb-2 text-right">Net</th>
                    <th className="pb-2 text-right">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentSales.map((row) => (
                    <tr key={row.orderId} className="border-b" style={{ borderColor: 'var(--c-border)' }}>
                      <td className="py-2 pr-2 text-pleros-white">{row.listingTitle}</td>
                      <td className="py-2">
                        <StatusBadge status={row.orderStatus} />
                      </td>
                      <td className="py-2 text-right">{money(row.agreedPriceCents)}</td>
                      <td className="py-2 text-right">{money(row.netCents)}</td>
                      <td className="py-2 text-right text-pleros-text-3">{fmtDate(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  )
}
