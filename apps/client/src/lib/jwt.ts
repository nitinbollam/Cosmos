/** Decode JWT payload (middle segment) without verification — client-side UX only. */
export function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const p = token.split('.')[1]
    if (!p) return null
    const s = atob(p.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return null
  }
}

export function jwtEmail(token: string | null): string | null {
  if (!token) return null
  const j = parseJwtPayload(token)
  const e = j?.email
  return typeof e === 'string' ? e : null
}
