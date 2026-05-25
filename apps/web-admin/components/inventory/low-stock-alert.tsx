import Link from 'next/link'
import { CardTitle } from '@cosmos/ui'

export type LowStockRow = { skuId: string; name: string; available: number; reorderPoint?: number }

export function LowStockAlert({ alerts }: { alerts: LowStockRow[] }) {
  return (
    <div className="cosmos-card">
      <CardTitle>Low stock</CardTitle>
      {alerts.length === 0 ? (
        <p className="text-sm mt-3" style={{ color: 'var(--c-text-3)' }}>
          No SKUs are at or below reorder point.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {alerts.slice(0, 8).map((a) => (
            <li
              key={a.skuId}
              className="flex flex-wrap items-center justify-between gap-2 text-sm border-b pb-3 last:border-0"
              style={{ borderColor: 'var(--c-border-card)' }}
            >
              <div className="min-w-0">
                <div style={{ color: 'var(--c-text)' }} className="font-medium truncate">
                  {a.name}
                </div>
                <div className="font-mono text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>
                  {a.available} available
                  {a.reorderPoint != null ? ` · reorder at ${a.reorderPoint}` : ''}
                </div>
              </div>
              <Link
                href={`/purchasing?skuId=${encodeURIComponent(a.skuId)}`}
                className="btn-primary !py-2 !px-3 !text-xs shrink-0 whitespace-nowrap"
              >
                Create PO
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
