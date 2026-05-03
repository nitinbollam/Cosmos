export function parseProxyParts(originalUrl: string): { service: string; restPath: string } | null {
  const q = originalUrl.indexOf('?')
  const pathOnly = q === -1 ? originalUrl : originalUrl.slice(0, q)
  const parts = pathOnly.split('/').filter(Boolean)
  const i = parts.indexOf('_proxy')
  if (i === -1 || i + 1 >= parts.length) return null
  const service = parts[i + 1]
  const restParts = parts.slice(i + 2)
  return { service, restPath: restParts.join('/') }
}
