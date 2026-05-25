import * as React from 'react'

export interface StatsCardProps {
  label: string
  value: number | string | null | undefined
  format?: 'currency' | 'number' | 'status' | 'percent'
  trend?: number
}

export function StatsCard({ label, value, format = 'number', trend }: StatsCardProps) {
  const formatted = formatValue(value, format)
  const trendClass = trend === undefined ? undefined : trend >= 0 ? 'bento-trend-pill bento-trend-pill--up' : 'bento-trend-pill bento-trend-pill--down'

  return (
    <div>
      <div className="bento-kpi-label">{label}</div>
      <div className="bento-kpi-value">{formatted}</div>
      {trend !== undefined && (
        <div className={`mt-2 inline-flex ${trendClass}`}>
          {trend >= 0 ? '+' : ''}
          {trend.toFixed(1)}%
        </div>
      )}
    </div>
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
