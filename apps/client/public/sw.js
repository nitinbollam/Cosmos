/* Pleros mobile PWA service worker — shell precache + runtime asset cache + offline queue sync */
const CACHE_SHELL = 'pleros-shell-v2'
const CACHE_ASSETS = 'pleros-assets-v2'
const CACHE_RUNTIME = 'pleros-runtime-v2'

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
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_SHELL)
      .then((cache) =>
        Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url).catch(() => undefined))),
      )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([CACHE_SHELL, CACHE_ASSETS, CACHE_RUNTIME])
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Vite hashed bundles — cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, CACHE_ASSETS))
    return
  }

  // SPA navigations under /m/ — network-first, fall back to cached shell
  if (req.mode === 'navigate' && (url.pathname.startsWith('/m/') || url.pathname === '/m')) {
    event.respondWith(networkFirstNavigation(req))
    return
  }

  // Mobile pages + API GETs — network with cache fallback
  if (url.pathname.startsWith('/m/') || url.pathname.startsWith('/api/')) {
    event.respondWith(networkThenCache(req, CACHE_RUNTIME))
    return
  }

  // Manifest / icons — cache-first
  if (
    url.pathname === '/manifest.webmanifest' ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith(cacheFirst(req, CACHE_SHELL))
  }
})

self.addEventListener('sync', (event) => {
  if (event.tag === 'pleros-offline-queue') {
    event.waitUntil(notifyClientsSync())
  }
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'PLEROS_REGISTER_SYNC') {
    event.waitUntil(
      (async () => {
        try {
          if (self.registration.sync) {
            await self.registration.sync.register('pleros-offline-queue')
          }
        } catch {
          // SyncManager unsupported or denied — clients still replay on online
        }
        await notifyClientsSync()
      })(),
    )
  }
  if (event.data?.type === 'PLEROS_SKIP_WAITING') {
    self.skipWaiting()
  }
})

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

async function networkThenCache(req, cacheName) {
  try {
    const res = await fetch(req)
    if (res.ok && req.url.startsWith(self.location.origin)) {
      const cache = await caches.open(cacheName)
      void cache.put(req, res.clone())
    }
    return res
  } catch {
    const cached = await caches.match(req)
    return cached ?? Response.error()
  }
}

async function networkFirstNavigation(req) {
  try {
    const res = await fetch(req)
    if (res.ok) {
      const cache = await caches.open(CACHE_SHELL)
      void cache.put('/index.html', res.clone())
    }
    return res
  } catch {
    return (
      (await caches.match('/index.html')) ||
      (await caches.match('/')) ||
      new Response('Pleros is offline. Reconnect to continue.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    )
  }
}

async function notifyClientsSync() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clients) {
    client.postMessage({ type: 'PLEROS_SYNC_QUEUE' })
  }
}
