import assert from 'node:assert/strict'
import test, { afterEach, beforeEach, mock } from 'node:test'

const memory = new Map<string, string>()

function installBrowserMocks(online = true) {
  memory.clear()

  const syncRegister = mock.fn(async () => undefined)
  const localStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value)
    },
    removeItem: (key: string) => {
      memory.delete(key)
    },
  }

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      dispatchEvent: mock.fn(() => true),
      addEventListener: mock.fn(),
      removeEventListener: mock.fn(),
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorage,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      onLine: online,
      serviceWorker: {
        ready: Promise.resolve({
          active: { postMessage: mock.fn() },
          sync: { register: syncRegister },
        }),
        addEventListener: mock.fn(),
        removeEventListener: mock.fn(),
      },
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'document', {
    value: {
      visibilityState: 'visible',
      addEventListener: mock.fn(),
      removeEventListener: mock.fn(),
    },
    configurable: true,
    writable: true,
  })

  return { syncRegister }
}

beforeEach(() => {
  installBrowserMocks(true)
})

afterEach(() => {
  mock.restoreAll()
})

test('replayOfflineQueue no-ops while offline', async () => {
  installBrowserMocks(false)
  const queue = await import('./offline-queue')
  const sync = await import('./offline-sync')
  const post = mock.fn(async () => undefined)

  queue.clearQueue()
  queue.enqueueAction('receiving_scan', { sessionId: 's1', code: 'A' })
  const result = await sync.replayOfflineQueue({ post })
  assert.deepEqual(result, { synced: 0, failed: 0 })
  assert.equal(queue.queueLength(), 1)
  assert.equal(post.mock.calls.length, 0)
})

test('replayOfflineQueue drains receiving actions when online', async () => {
  installBrowserMocks(true)
  const queue = await import('./offline-queue')
  const sync = await import('./offline-sync')
  const post = mock.fn(async () => undefined)

  queue.clearQueue()
  queue.enqueueAction('receiving_session_create', { poId: 'po1' })
  queue.enqueueAction('receiving_scan', { sessionId: 'sess1', code: 'SKU-9' })

  const result = await sync.replayOfflineQueue({ post })
  assert.equal(result.synced, 2)
  assert.equal(result.failed, 0)
  assert.equal(queue.queueLength(), 0)
  assert.equal(post.mock.calls.length, 2)
  assert.equal((post.mock.calls[0]?.arguments as unknown[])?.[0], '/wms/receiving/sessions')
  assert.equal((post.mock.calls[1]?.arguments as unknown[])?.[0], '/wms/receiving/sessions/sess1/scan')
})

test('replayOfflineQueue re-registers Background Sync when items remain after failure', async () => {
  const { syncRegister } = installBrowserMocks(true)
  const queue = await import('./offline-queue')
  const sync = await import('./offline-sync')
  const post = mock.fn(async () => {
    throw new Error('network')
  })

  queue.clearQueue()
  queue.enqueueAction('receiving_scan', { sessionId: 's1', code: 'X' })
  await new Promise((r) => setTimeout(r, 0))
  syncRegister.mock.resetCalls()

  const result = await sync.replayOfflineQueue({ post })
  assert.equal(result.failed, 1)
  assert.equal(queue.queueLength(), 1)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(syncRegister.mock.calls.length >= 1, true)
})

test('registerOfflineSyncListeners cleans up all handlers', async () => {
  installBrowserMocks(true)
  const sync = await import('./offline-sync')

  const unsub = sync.registerOfflineSyncListeners()
  assert.equal(typeof unsub, 'function')
  unsub()

  const win = globalThis.window as unknown as {
    removeEventListener: ReturnType<typeof mock.fn>
  }
  const doc = globalThis.document as unknown as {
    removeEventListener: ReturnType<typeof mock.fn>
  }
  assert.equal(win.removeEventListener.mock.calls.length >= 2, true)
  assert.equal(doc.removeEventListener.mock.calls.length >= 1, true)
})
