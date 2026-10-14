/**
 * Requests to URLs a tenant chose (webhooks, EDI endpoints). Without these checks the server could
 * be pointed at its own network: cloud metadata, internal services, localhost.
 */
import { lookup, type LookupAddress } from 'node:dns'
import type { IncomingHttpHeaders } from 'node:http'
import { request } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { ApiError } from './session'

/** Resolves a host name to every address it points at. Swappable in tests. */
export type ResolveHost = (host: string) => Promise<LookupAddress[]>

const resolveHost: ResolveHost = (host) =>
  new Promise((resolve, reject) =>
    lookup(host, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))),
  )

/**
 * Addresses a tenant-chosen URL may never reach: this machine, private networks, link-local
 * (cloud metadata), carrier-grade NAT (some hosts' internal networks), multicast and reserved
 * ranges. IPv4-mapped, IPv4-compatible and NAT64 IPv6 forms are blocked whole so they can't
 * smuggle one in.
 */
const BLOCKED_IPV4 = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_IPV4.addSubnet(network, prefix, 'ipv4')
}
// Kept apart from the IPv4 list: newer Node versions match IPv4 addresses against IPv6 rules
// (so a ::ffff:0:0/96 rule there would block every IPv4 address).
const BLOCKED_IPV6 = new BlockList()
for (const [network, prefix] of [
  ['::', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED_IPV6.addSubnet(network, prefix, 'ipv6')
}

/** True for any address a tenant-chosen URL must not reach (anything that isn't an IP counts as blocked). */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return BLOCKED_IPV4.check(ip, 'ipv4')
  if (family === 6) return BLOCKED_IPV6.check(ip, 'ipv6')
  return true
}

/** URL host without the brackets URLs put around IPv6 literals. */
function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

/** Throws unless `raw` is an https URL whose host is, and resolves only to, public addresses. */
export async function assertPublicHttpsUrl(
  raw: string,
  label: string,
  resolve: ResolveHost = resolveHost,
): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ApiError(400, `${label} must be a valid URL`)
  }
  if (url.protocol !== 'https:') {
    throw new ApiError(400, `${label} must use https`)
  }
  const host = bareHost(url)
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ApiError(400, `${label} cannot target internal hosts`)
  }
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new ApiError(400, `${label} cannot target private IP ranges`)
    return url
  }
  let addresses: LookupAddress[]
  try {
    addresses = await resolve(host)
  } catch {
    throw new ApiError(400, `${label} host could not be resolved`)
  }
  if (addresses.length === 0) throw new ApiError(400, `${label} host could not be resolved`)
  if (addresses.some((a) => isBlockedAddress(a.address))) {
    throw new ApiError(400, `${label} resolves to a private IP range`)
  }
  return url
}

/**
 * DNS lookup for the connection itself. The name is resolved again here, as the socket opens,
 * so a host that answered with a public address during validation can't switch to an internal
 * one for the real request. Handles both callback forms Node uses (`all` or single).
 */
export function guardedLookup(resolve: ResolveHost = resolveHost): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname)
      .then((addresses) => {
        if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
          throw new ApiError(400, 'URL resolves to a private IP range')
        }
        const family = typeof options.family === 'number' ? options.family : 0
        const usable = family ? addresses.filter((a) => a.family === family) : addresses
        if (usable.length === 0) throw new ApiError(400, 'URL host could not be resolved')
        if (options.all) callback(null, usable)
        else callback(null, usable[0]!.address, usable[0]!.family)
      })
      .catch((err: NodeJS.ErrnoException) => callback(err, ''))
  }
}

/** Response bodies beyond this are cut off: callers only need a status line or a confirmation id. */
const MAX_RESPONSE_BYTES = 64 * 1024

/**
 * POST to a URL that passed assertPublicHttpsUrl. Redirects are never followed (a 3xx is just
 * the response), so a public endpoint can't bounce the request to an internal address. IP-literal
 * hosts skip DNS entirely, so they're checked here too.
 */
export async function postToPublicUrl(
  url: URL,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  resolve: ResolveHost = resolveHost,
): Promise<{ status: number; headers: IncomingHttpHeaders; text: string }> {
  const host = bareHost(url)
  if (url.protocol !== 'https:' || (isIP(host) && isBlockedAddress(host))) {
    throw new ApiError(400, 'URL cannot target private IP ranges')
  }
  return new Promise((done, fail) => {
    const req = request(
      {
        hostname: host,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        lookup: guardedLookup(resolve),
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        const finish = () =>
          done({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8').slice(0, MAX_RESPONSE_BYTES),
          })
        res.on('data', (chunk: Buffer) => {
          if (size >= MAX_RESPONSE_BYTES) return
          chunks.push(chunk)
          size += chunk.length
          if (size >= MAX_RESPONSE_BYTES) {
            finish()
            res.destroy()
          }
        })
        res.on('end', finish)
        res.on('error', fail)
      },
    )
    req.on('error', fail)
    req.end(body)
  })
}
