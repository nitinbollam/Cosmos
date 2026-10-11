/** What is being delivered at a stop, as sent with each route stop by the server. No prices. */
export type StopItem = {
  skuCode: string
  name: string
  quantity: number
  ageRestricted: boolean
  minimumAge: number | null
}

/** “21+” tag for age-restricted products and stops. Uses theme variables, so it works in admin and mobile. */
export function AgeTag({ minimumAge, label = 'check ID' }: { minimumAge: number | null; label?: string }) {
  return (
    <span
      title={`Age-restricted: recipient must be ${minimumAge ?? 21} or older`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 7px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        background: 'var(--c-danger-soft)',
        color: 'var(--c-danger)',
      }}
    >
      {minimumAge ?? 21}+{label ? ` · ${label}` : ''}
    </span>
  )
}

/**
 * The products on one stop: quantity × name (code), with a 21+ tag on age-restricted lines.
 * Renders nothing for stops not linked to an order.
 */
export function StopItems({ items }: { items?: StopItem[] | null }) {
  if (!items?.length) return null
  return (
    <ul aria-label="Items for this stop" style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 3 }}>
      {items.map((item) => (
        <li key={item.skuCode} style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', fontSize: 12.5 }}>
          <strong style={{ minWidth: 26 }}>{item.quantity} ×</strong>
          <span>{item.name}</span>
          <span style={{ opacity: 0.6, fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11 }}>{item.skuCode}</span>
          {item.ageRestricted && <AgeTag minimumAge={item.minimumAge} label="" />}
        </li>
      ))}
    </ul>
  )
}
