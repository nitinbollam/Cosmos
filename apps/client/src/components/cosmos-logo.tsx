import type { ReactNode } from 'react'

type CosmosLogoProps = {
  variant?: 'full' | 'mark' | 'wordmark'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  title?: string
}

const heights = { sm: 32, md: 38, lg: 56 } as const

const MARK = '#7161EF'
const MARK_SOFT = '#957FEF'
const INK = '#2D2640'
const MUTED = '#5F5775'

/** Orbital mark — 52×52 artboard with safe padding */
function CosmosMarkGraphic() {
  return (
    <>
      <circle cx="26" cy="26" r="13.5" stroke={MARK} strokeWidth="1.25" />
      <circle cx="26" cy="26" r="8.25" stroke={MARK} strokeWidth="0.85" opacity="0.45" />
      <ellipse
        cx="26"
        cy="26"
        rx="19.5"
        ry="6.75"
        stroke={MARK_SOFT}
        strokeWidth="1"
        transform="rotate(-30 26 26)"
        opacity="0.75"
      />
      <circle cx="26" cy="26" r="2.1" fill={MARK} />
      <circle cx="41.5" cy="17.5" r="1.35" fill={MARK_SOFT} opacity="0.9" />
    </>
  )
}

function CosmosLogoSvg({
  viewBox,
  height,
  className,
  title,
  children,
}: {
  viewBox: string
  height: number
  className?: string
  title: string
  children: ReactNode
}) {
  const [, , vw, vh] = viewBox.split(/\s+/).map(Number)
  const width = Math.round(height * (vw / vh))

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
    >
      <title>{title}</title>
      {children}
    </svg>
  )
}

export function CosmosLogo({
  variant = 'full',
  size = 'md',
  className,
  title = 'Cosmos',
}: CosmosLogoProps) {
  const height = heights[size]

  if (variant === 'mark') {
    return (
      <CosmosLogoSvg viewBox="0 0 52 52" height={height} className={className} title={title}>
        <CosmosMarkGraphic />
      </CosmosLogoSvg>
    )
  }

  if (variant === 'wordmark') {
    return (
      <CosmosLogoSvg viewBox="0 0 108 32" height={height} className={className} title={title}>
        <text
          x="0"
          y="24"
          fill={INK}
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="26"
          fontWeight="500"
          letterSpacing="-0.02em"
        >
          cosmos
        </text>
      </CosmosLogoSvg>
    )
  }

  if (size === 'lg') {
    return (
      <CosmosLogoSvg viewBox="0 0 188 56" height={height} className={className} title={title}>
        <g transform="translate(2 2)">
          <CosmosMarkGraphic />
        </g>
        <text
          x="58"
          y="34"
          fill={INK}
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="26"
          fontWeight="500"
          letterSpacing="-0.02em"
        >
          cosmos
        </text>
        <text
          x="59"
          y="50"
          fill={MUTED}
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="8.5"
          fontWeight="500"
          letterSpacing="0.14em"
        >
          DISTRIBUTION ERP
        </text>
      </CosmosLogoSvg>
    )
  }

  return (
    <CosmosLogoSvg viewBox="0 0 168 56" height={height} className={className} title={title}>
      <g transform="translate(0 2)">
        <CosmosMarkGraphic />
      </g>
      <text
        x="58"
        y="35"
        fill={INK}
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="26"
        fontWeight="500"
        letterSpacing="-0.02em"
      >
        cosmos
      </text>
    </CosmosLogoSvg>
  )
}
