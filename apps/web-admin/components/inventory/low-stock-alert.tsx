import { Card, CardTitle } from '@cosmos/ui'

export function LowStockAlert({ alerts }: { alerts: { skuId: string; name: string; available: number }[] }) {
  return (
    <Card>
      <CardTitle>Low stock</CardTitle>
      {alerts.length === 0 ? (
        <div className="text-cosmos-muted text-sm mt-2">No low-stock items</div>
      ) : (
        <ul className="mt-2 space-y-1">
          {alerts.slice(0, 5).map((a) => (
            <li key={a.skuId} className="text-sm flex justify-between">
              <span className="text-cosmos-text">{a.name}</span>
              <span className="text-cosmos-warning">{a.available} left</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
