import * as React from 'react'
import { Card } from './Card'

export interface StatsCardProps {
  label: string
  value: number | string | null | undefined
  format?: 'currency' | 'number' | 'status' | 'percent'
  trend?: number
}

export function StatsCard({ label, value, format = 'number', trend }: StatsCardProps) {
  const formatted = formatValue(value, format)
  const trendColor = trend === undefined ? '' : trend >= 0 ? 'text-emerald-400' : 'text-red-400'
  return (
    <Card>
      <div className="text-xs uppercase tracking-wider text-cosmos-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-cosmos-white">{formatted}</div>
      {trend !== undefined && (
        <div className={`mt-1 text-xs ${trendColor}`}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
        </div>
      )}
    </Card>
  )
}

function formatValue(v: unknown, fmt: StatsCardProps['format']): string {
  if (v === null || v === undefined) return '—'
  switch (fmt) {
    case 'currency':
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v))
    case 'number':
      return new Intl.NumberFormat('en-US').format(Number(v))
    case 'percent':
      return `${(Number(v) * 100).toFixed(1)}%`
    case 'status':
    default:
      return String(v)
  }
}
