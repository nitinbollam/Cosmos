import { KpiService } from '../kpi.service'

describe('KpiService', () => {
  it('upsertSnapshot delegates to prisma', async () => {
    const prisma = {
      dailyKpiSnapshot: { upsert: jest.fn().mockResolvedValue({ id: 'x' }) },
    } as never
    const svc = new KpiService(prisma)
    await svc.upsertSnapshot('ten', {
      date: '2026-05-01',
      ordersCount: 3,
      revenue: 99.5,
      skusActive: 12,
    })
    expect((prisma as any).dailyKpiSnapshot.upsert).toHaveBeenCalled()
  })
})

describe('KpiService.dashboardKpis', () => {
  it('returns zeros without snapshots', async () => {
    const prisma = {
      dailyKpiSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    } as never
    const svc = new KpiService(prisma)
    const row = await svc.dashboardKpis('t1')
    expect(row.todayRevenue).toBe(0)
    expect(row.msaStatus).toBe('NO_DATA')
  })
})
