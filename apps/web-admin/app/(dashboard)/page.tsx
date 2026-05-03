'use client'
import { useQuery } from '@tanstack/react-query'
import { StatsCard } from '@cosmos/ui'
import { api } from '@/lib/api'
import { LowStockAlert } from '@/components/inventory/low-stock-alert'
import { RecentOrders } from '@/components/orders/recent-orders'
import { MSAStatusCard } from '@/components/compliance/msa-status-card'

interface Kpis {
  todayRevenue: number
  revenueTrend: number
  openOrders: number
  ordersTrend: number
  itemsPicked: number
  msaStatus: string
}

export default function DashboardPage() {
  const { data: kpis } = useQuery<Kpis>({
    queryKey: ['dashboard', 'kpis'],
    queryFn: () => api.get<Kpis>('/analytics/kpis'),
    refetchInterval: 30_000,
  })

  const { data: alerts } = useQuery<{ lowStock: { skuId: string; name: string; available: number }[] }>({
    queryKey: ['dashboard', 'alerts'],
    queryFn: () => api.get('/inventory/alerts'),
    refetchInterval: 60_000,
  })

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-cosmos-white">Command Center</h1>
          <p className="text-cosmos-muted text-sm mt-1">Real-time operations overview</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-cosmos-muted">Live</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatsCard label="Today's Revenue" value={kpis?.todayRevenue ?? null} format="currency" trend={kpis?.revenueTrend} />
        <StatsCard label="Open Orders" value={kpis?.openOrders ?? null} format="number" trend={kpis?.ordersTrend} />
        <StatsCard label="Items Picked Today" value={kpis?.itemsPicked ?? null} format="number" />
        <StatsCard label="MSA Status" value={kpis?.msaStatus ?? null} format="status" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2"><RecentOrders /></div>
        <div className="space-y-4">
          <MSAStatusCard />
          <LowStockAlert alerts={alerts?.lowStock ?? []} />
        </div>
      </div>
    </div>
  )
}
