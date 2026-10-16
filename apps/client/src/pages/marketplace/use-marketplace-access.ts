import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { api } from '@/lib/api-admin'
import { getAccessToken } from '@/lib/auth-session'
import { parseJwtPayload } from '@/lib/jwt'

type Me = { role?: string; permissions?: string[] }

const ADMIN_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN']

/**
 * What the signed-in user may do in the marketplace, in the area this page belongs to: the
 * storefront (/marketplace, buying) or the distributor admin portal (/admin/marketplace).
 * Listing and inventory management is for administrators only; the server enforces the same.
 */
export function useMarketplaceAccess() {
  const isAdminPortal = useLocation().pathname.startsWith('/admin')
  const token = getAccessToken(isAdminPortal ? 'admin' : 'shop')
  const signedIn = Boolean(token)
  // The storefront has its own login, keyed by who is signed in so a different user on this
  // device never sees the previous user's access. The admin key is the sidebar's (fetched once).
  const shopUser = token ? String(parseJwtPayload(token)?.sub ?? '') : ''
  const { data: me, isLoading, isError } = useQuery({
    queryKey: isAdminPortal ? ['auth-me'] : ['auth-me', 'shop', shopUser],
    queryFn: () => api.get<Me>('/auth/me'),
    enabled: signedIn,
  })
  const isAdmin = ADMIN_ROLES.includes(me?.role ?? '')
  const perms = me?.permissions ?? []
  const canBrowse =
    isAdmin || ['*', 'marketplace.*', 'marketplace.read'].some((p) => perms.includes(p))
  return {
    isAdminPortal,
    loading: signedIn && isLoading,
    /** Access couldn't be checked (e.g. offline): show the page and let the server decide. */
    failed: isError,
    canBrowse,
    /** Create, remove and view own listings (they reserve and release stock). Admin portal only. */
    canManageListings: isAdminPortal && isAdmin,
  }
}
