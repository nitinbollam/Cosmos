/**
 * Celestial answers may only link to internal Pleros screens. Anything else — external sites,
 * protocol-relative URLs, javascript:/data: schemes, path traversal — renders as plain text.
 */
const APPROVED_PREFIXES = ['/admin', '/catalog', '/orders', '/quotes', '/invoices', '/m/']

export function isApprovedCelestialHref(href: string | null | undefined): href is string {
  if (!href) return false
  const h = href.trim()
  if (!h.startsWith('/') || h.startsWith('//') || h.includes('\\')) return false
  if (/(^|\/)\.\.(\/|$)/.test(h) || /%2e%2e/i.test(h)) return false
  const path = h.split(/[?#]/)[0]
  return APPROVED_PREFIXES.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)))
}

export function approvedCelestialLinks<T extends { href: string }>(links: T[] | undefined): T[] {
  return (links ?? []).filter((l) => isApprovedCelestialHref(l.href))
}
