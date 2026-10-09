/**
 * The B2B buyer's tenant and CRM customer id.
 *
 * Stored next to the tokens (localStorage, not per-tab sessionStorage) so a new tab, an
 * emailed link or a browser restart still knows who the buyer is. Stamped with the user
 * signed in to the buyer portal so it can never be read under someone else's session.
 */
import { currentIdentity, ownerKeyOf } from '@/lib/session-identity'

const KEY = 'pleros.b2bSession'
const LEGACY_TENANT = 'pleros.tenantId'
const LEGACY_CUSTOMER = 'pleros.customerId'

type StoredB2bSession = { owner: string; tenantId: string; customerId: string }

function read(): StoredB2bSession | null {
  if (typeof window === 'undefined') return null
  const owner = ownerKeyOf(currentIdentity('shop'))
  if (!owner) return null
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as StoredB2bSession) : null
    return parsed && parsed.owner === owner ? parsed : null
  } catch {
    return null
  }
}

export function setB2bSession(tenantId: string, customerId: string) {
  if (typeof window === 'undefined') return
  const owner = ownerKeyOf(currentIdentity('shop'))
  if (!owner) return
  window.localStorage.setItem(KEY, JSON.stringify({ owner, tenantId, customerId } satisfies StoredB2bSession))
}

export function clearB2bSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(KEY)
  try {
    window.sessionStorage.removeItem(LEGACY_TENANT)
    window.sessionStorage.removeItem(LEGACY_CUSTOMER)
  } catch {
    /* sessionStorage unavailable */
  }
}

export function getB2bCustomerId(): string | null {
  return read()?.customerId ?? null
}

export function getB2bTenantId(): string | null {
  return read()?.tenantId ?? null
}

/**
 * The buyer's customer id, looked up from `/auth/me` when this device doesn't have it yet
 * (e.g. signed in before this was stored). Null for staff accounts and signed-out visitors.
 */
export async function ensureB2bCustomerId(): Promise<string | null> {
  const known = getB2bCustomerId()
  if (known) return known
  if (!currentIdentity('shop')) return null
  try {
    const { api } = await import('@/lib/api')
    const me = await api.get<{ tenantId: string; customerId?: string | null }>('/auth/me')
    if (me.customerId) {
      setB2bSession(me.tenantId, me.customerId)
      return me.customerId
    }
  } catch {
    /* leave it to the caller */
  }
  return null
}
