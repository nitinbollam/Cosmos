const CACHE = 'cosmos-mobile-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (!url.pathname.startsWith('/m/') && !url.pathname.startsWith('/api/')) return
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((r) => r ?? Response.error())),
  )
})

self.addEventListener('sync', (event) => {
  if (event.tag === 'cosmos-offline-queue') {
    event.waitUntil(notifyClientsSync())
  }
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'COSMOS_REGISTER_SYNC') {
    event.waitUntil(notifyClientsSync())
  }
})

async function notifyClientsSync() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clients) {
    client.postMessage({ type: 'COSMOS_SYNC_QUEUE' })
  }
}
