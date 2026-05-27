/** Admin UI routes live under `/admin/*`. */
export function adminPath(path: string): string {
  const q = path.indexOf('?')
  const pathname = q >= 0 ? path.slice(0, q) : path
  const search = q >= 0 ? path.slice(q) : ''
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`
  const base = p === '/admin' || p.startsWith('/admin/') ? p : `/admin${p}`
  return `${base}${search}`
}

/** Full URL for admin deep links from storefront (same origin when env unset). */
export function storefrontAdminHref(path: string): string {
  const origin = import.meta.env.VITE_WEB_ADMIN_ORIGIN?.replace(/\/$/, '') ?? ''
  const route = adminPath(path)
  return origin ? `${origin}${route}` : route
}
