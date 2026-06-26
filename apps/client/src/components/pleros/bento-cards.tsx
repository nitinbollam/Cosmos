import type { ReactNode } from 'react'

type CardTone = 'white' | 'blush' | 'muted' | 'ink'

export function BentoTrendPill({ value }: { value: number }) {
  const up = value >= 0
  return (
    <span className={`bento-trend-pill ${up ? 'bento-trend-pill--up' : 'bento-trend-pill--down'}`}>
      {up ? '+' : ''}
      {value.toFixed(0)}%
    </span>
  )
}

export function BentoSparkline({
  points,
  color = 'var(--c-primary)',
  height = 44,
}: {
  points: number[]
  color?: string
  height?: number
}) {
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const w = 120
  const coords = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w
      const y = height - ((p - min) / range) * (height - 8) - 4
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} className="block mt-auto" aria-hidden>
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={coords} />
    </svg>
  )
}

export function BentoDonut({
  percent,
  label,
  sublabel,
  size = 112,
}: {
  percent: number
  label: string
  sublabel?: string
  size?: number
}) {
  const clamped = Math.max(0, Math.min(100, percent))
  const stroke = 9
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c - (clamped / 100) * c

  return (
    <div className="flex flex-col items-center justify-center text-center h-full min-h-[170px]">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-chart-grid)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--c-primary)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-bold tracking-tight" style={{ color: 'var(--c-heading)' }}>
            {Math.round(clamped)}%
          </span>
        </div>
      </div>
      <p className="bento-kpi-label mt-4">{label}</p>
      {sublabel ? <p className="text-xs mt-1" style={{ color: 'var(--c-text-2)' }}>{sublabel}</p> : null}
    </div>
  )
}

function toneClass(tone: CardTone) {
  if (tone === 'white') return 'bento-tone-white'
  if (tone === 'ink') return 'bento-tone-ink'
  return 'bento-tone-muted'
}

export function BentoMetricCard({
  label,
  value,
  trend,
  sparkline,
  tone = 'muted',
  className = '',
}: {
  label: string
  value: string
  trend?: number
  sparkline?: number[]
  tone?: CardTone
  className?: string
}) {
  return (
    <div className={`bento-cell bento-metric ${toneClass(tone)} flex flex-col min-h-[148px] h-full ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="bento-kpi-label">{label}</p>
        {trend !== undefined ? <BentoTrendPill value={trend} /> : null}
      </div>
      <p className="bento-kpi-value mt-3">{value}</p>
      {sparkline && sparkline.length > 1 ? (
        <div className="mt-auto pt-3">
          <BentoSparkline points={sparkline} />
        </div>
      ) : null}
    </div>
  )
}

export function BentoHeroCard({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string
  subtitle: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={`bento-cell bento-hero bento-tone-white flex flex-col justify-between h-full min-h-[220px] ${className}`}>
      <div>
        <p className="bento-kpi-label mb-3">Overview</p>
        <h2 className="bento-hero-title">{title}</h2>
        <p className="bento-hero-sub mt-3">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

export function BentoAvatarStack({ labels }: { labels: string[] }) {
  const shown = labels.slice(0, 4)
  const fills = ['var(--c-surface-2)', 'var(--c-surface-3)', 'var(--c-primary-dim)', 'var(--c-accent-dim)']
  return (
    <div className="flex items-center gap-3 mt-4">
      <div className="flex -space-x-2">
        {shown.map((label, i) => (
          <span
            key={`${label}-${i}`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[10px] font-bold border-2"
            style={{ background: fills[i % fills.length], color: 'var(--c-text)', borderColor: 'var(--c-border-card)' }}
          >
            {label.slice(0, 2).toUpperCase()}
          </span>
        ))}
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--c-text-2)' }}>
        Ops, sales & warehouse
      </p>
    </div>
  )
}
