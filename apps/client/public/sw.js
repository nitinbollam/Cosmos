/* Pleros mobile PWA — app-shell precache, network-first per-user API GETs, offline queue sync */
const CACHE_SHELL = 'pleros-shell-v4'
const CACHE_ASSETS = 'pleros-assets-v4'
/**
 * API responses are cached per signed-in user: `pleros-api-v4:<tenantId>:<userId>`.
 * One user's cached data is never served to another on a shared device.
 */
const CACHE_API_PREFIX = 'pleros-api-v4'

/**
 * Mobile SPA shells (same document as /index.html).
 * Kept in sync with apps/client/pwa-shell-routes.json via vite inject.
 */
const MOBILE_SHELL_ROUTES = [
  '/m/login',
  '/m/warehouse',
  '/m/warehouse/receiving',
  '/m/delivery',
  '/m/sales',
  '/m/home',
  '/m/queue',
]

/** Injected at build time by vite.config.ts; fallback list for dev. */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/pleros-icon-192.png',
  '/pleros-icon-512.png',
  '/m/login',
  '/m/warehouse',
  '/m/warehouse/receiving',
  '/m/delivery',
  '/m/sales',
  '/m/home',
  '/m/queue',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL)
      await precacheAppShell(cache)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([CACHE_SHELL, CACHE_ASSETS])
      const keys = await caches.keys()
      // Drops every v3 cache, including the old shared API cache that wasn't split per user.
      await Promise.all(
        keys.filter((k) => !keep.has(k) && !k.startsWith(`${CACHE_API_PREFIX}:`)).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Vite hashed bundles + fonts — cache-first (content-hashed, immutable)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, CACHE_ASSETS))
    return
  }

  // SPA navigations under /m/ — shell-first for instant offline load
  if (req.mode === 'navigate' && isMobilePath(url.pathname)) {
    event.respondWith(shellFirstNavigation(req))
    return
  }

  // Mobile document requests (non-navigate) — same shell strategy
  if (isMobilePath(url.pathname) && acceptsHtml(req)) {
    event.respondWith(shellFirstNavigation(req))
    return
  }

  // API GETs — network first so screens never show data from before a save; the per-user
  // cache is only an offline fallback. Requests without a session are never cached.
  if (isCacheableApiGet(url.pathname)) {
    const cacheName = apiCacheNameFor(req)
    if (cacheName) event.respondWith(networkFirstApi(req, cacheName))
    return
  }

  // Manifest / icons — cache-first
  if (
    url.pathname === '/manifest.webmanifest' ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webmanifest') ||
    url.pathname.endsWith('.ico')
  ) {
    event.respondWith(cacheFirst(req, CACHE_SHELL))
  }
})

/** Must match OFFLINE_SYNC_TAG in apps/client/src/lib/offline-queue.ts */
const OFFLINE_SYNC_TAG = 'pleros-offline-queue'

self.addEventListener('sync', (event) => {
  if (event.tag === OFFLINE_SYNC_TAG) {
    event.waitUntil(notifyClientsSync())
  }
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'PLEROS_REGISTER_SYNC') {
    event.waitUntil(
      (async () => {
        try {
          if (self.registration.sync) {
            await self.registration.sync.register(OFFLINE_SYNC_TAG)
          }
        } catch {
          /* SyncManager unsupported — clients still replay on online */
        }
        await notifyClientsSync()
      })(),
    )
  }
  if (event.data?.type === 'PLEROS_SKIP_WAITING') {
    self.skipWaiting()
  }
  if (event.data?.type === 'PLEROS_CLEAR_API_CACHE') {
    event.waitUntil(clearApiCaches())
  }
})

/** Push alerts from the server: { title, body, url?, tag? } (apps/web/lib/server/push.ts). */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Pleros'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/pleros-icon-192.png',
      badge: '/favicon-32.png',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      data: { url: typeof data.url === 'string' ? data.url : '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openFromNotification(event.notification.data && event.notification.data.url))
})

/** Open the notification's link, only ever on this site (anything else opens the home page). */
async function openFromNotification(raw) {
  let target = new URL('/', self.location.origin)
  try {
    const url = new URL(raw || '/', self.location.origin)
    if (url.origin === self.location.origin) target = url
  } catch {
    /* keep the home page */
  }
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of windows) {
    if (new URL(client.url).origin !== self.location.origin) continue
    try {
      await client.focus()
      if ('navigate' in client) await client.navigate(target.href)
      return
    } catch {
      break // a tab this worker can't steer: open a new one instead
    }
  }
  await self.clients.openWindow(target.href)
}

async function clearApiCaches() {
  const keys = await caches.keys()
  await Promise.all(keys.filter((k) => k.startsWith(`${CACHE_API_PREFIX}:`)).map((k) => caches.delete(k)))
}

function isMobilePath(pathname) {
  return pathname === '/m' || pathname.startsWith('/m/')
}

function acceptsHtml(req) {
  const accept = req.headers.get('Accept') || ''
  return accept.includes('text/html')
}

/** Skip auth/session endpoints — never serve stale credentials. */
function isCacheableApiGet(pathname) {
  if (!pathname.startsWith('/api/')) return false
  if (pathname.startsWith('/api/v1/auth')) return false
  if (pathname.includes('/password')) return false
  if (pathname.includes('/invite')) return false
  return true
}

/**
 * Fetch index.html once and store under every mobile shell route so
 * offline navigations to /m/warehouse, /m/delivery, /m/sales hit immediately.
 * Also precache icons/manifest and (after build inject) hashed /assets/*.
 */
async function precacheAppShell(cache) {
  const shellSet = new Set(['/', '/index.html', ...MOBILE_SHELL_ROUTES])

  await Promise.allSettled(
    PRECACHE_URLS.filter((url) => !shellSet.has(url)).map((url) =>
      cache.add(url).catch(() => undefined),
    ),
  )

  try {
    const indexRes = await fetch('/index.html', { cache: 'reload' })
    if (!indexRes.ok) return
    const body = await indexRes.blob()
    const headers = new Headers(indexRes.headers)
    headers.set('X-Pleros-Shell', '1')

    const putShell = async (key) => {
      await cache.put(key, new Response(body.slice(0), { status: 200, statusText: 'OK', headers }))
    }

    await putShell('/index.html')
    await putShell('/')
    for (const route of MOBILE_SHELL_ROUTES) {
      await putShell(route)
    }
  } catch {
    /* offline during install — keep whatever was already cached */
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req)
  if (cached) return cached
  try {
    const res = await fetch(req)
    if (res.ok) {
      const cache = await caches.open(cacheName)
      void cache.put(req, res.clone())
    }
    return res
  } catch {
    return cached ?? Response.error()
  }
}

/**
 * Cache partition for the user making the request, from the Bearer token's (unverified)
 * claims. The claims only pick a cache; the server still verifies every request.
 */
function apiCacheNameFor(req) {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  try {
    const part = auth.slice(7).split('.')[1]
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof json.sub !== 'string' || typeof json.tenantId !== 'string') return null
    return `${CACHE_API_PREFIX}:${json.tenantId}:${json.sub}`
  } catch {
    return null
  }
}

/** Network first; fall back to this user's cached copy only when the network is unreachable. */
async function networkFirstApi(req, cacheName) {
  try {
    const res = await fetch(req)
    if (res.ok) {
      const cache = await caches.open(cacheName)
      void cache.put(req, res.clone())
    }
    return res
  } catch {
    const cache = await caches.open(cacheName)
    const cached = await cache.match(req)
    return (
      cached ??
      new Response(JSON.stringify({ message: 'Offline — no cached API response' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    )
  }
}

/**
 * Instant app shell: prefer cached document, fall back to /index.html,
 * revalidate when the network is available.
 */
async function shellFirstNavigation(req) {
  const cache = await caches.open(CACHE_SHELL)
  const url = new URL(req.url)

  const networkPromise = fetch(req)
    .then(async (res) => {
      if (res.ok) {
        await cache.put('/index.html', res.clone())
        await cache.put(url.pathname, res.clone())
      }
      return res
    })
    .catch(() => undefined)

  const cachedExact =
    (await cache.match(url.pathname)) ||
    (await cache.match(req)) ||
    (await caches.match(url.pathname)) ||
    (await caches.match(req))

  if (cachedExact) {
    void networkPromise
    return cachedExact
  }

  const shell = (await cache.match('/index.html')) || (await cache.match('/'))
  if (shell) {
    void networkPromise
    return shell
  }

  const res = await networkPromise
  return (
    res ??
    new Response('Pleros is offline. Open once online to cache the app shell.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  )
}

async function notifyClientsSync() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clients) {
    client.postMessage({ type: 'PLEROS_SYNC_QUEUE' })
  }
}
