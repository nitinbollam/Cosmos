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

function httpError(status: number, message: string) {
  const err = new Error(message) as Error & {
    response: { status: number; data: { message: string } }
  }
  err.response = { status, data: { message } }
  return err
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
  assert.deepEqual(result, { synced: 0, failed: 0, conflicts: 0, errors: [] })
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
  assert.equal(result.conflicts, 0)
  assert.equal(queue.queueLength(), 0)
  assert.equal(post.mock.calls.length, 2)
  assert.equal((post.mock.calls[0]?.arguments as unknown[])?.[0], '/wms/receiving/sessions')
  assert.equal((post.mock.calls[1]?.arguments as unknown[])?.[0], '/wms/receiving/sessions/sess1/scan')
})

test('replayOfflineQueue keeps transient failures with lastError and re-registers sync', async () => {
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
  assert.equal(result.conflicts, 0)
  assert.equal(queue.queueLength(), 1)
  const item = queue.readQueue()[0]!
  assert.equal(item.status, 'failed')
  assert.equal(item.lastError, 'network')
  assert.equal(item.attempts, 1)
  assert.equal(result.errors[0]?.message, 'network')
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(syncRegister.mock.calls.length >= 1, true)
})

test('replayOfflineQueue surfaces 409 as conflict and does not auto-retry it', async () => {
  const { syncRegister } = installBrowserMocks(true)
  const queue = await import('./offline-queue')
  const sync = await import('./offline-sync')
  const post = mock.fn(async () => {
    throw httpError(409, 'Receiving session is no longer open')
  })

  queue.clearQueue()
  queue.enqueueAction('receiving_scan', { sessionId: 'stale', code: 'X' })
  await new Promise((r) => setTimeout(r, 0))
  syncRegister.mock.resetCalls()

  const first = await sync.replayOfflineQueue({ post })
  assert.equal(first.conflicts, 1)
  assert.equal(first.failed, 0)
  assert.equal(queue.readQueue()[0]?.status, 'conflict')
  assert.match(queue.readQueue()[0]?.lastError ?? '', /no longer open/)

  // Second auto pass skips conflicts — post not called again
  post.mock.resetCalls()
  const second = await sync.replayOfflineQueue({ post })
  assert.equal(second.conflicts, 1)
  assert.equal(post.mock.calls.length, 0)
  assert.equal(queue.replayableCount(), 0)

  // Background Sync should not re-register when only conflicts remain
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(syncRegister.mock.calls.length, 0)
})

test('replayOfflineQueue retries conflicts when retryConflicts is set', async () => {
  installBrowserMocks(true)
  const queue = await import('./offline-queue')
  const sync = await import('./offline-sync')
  let calls = 0
  const post = mock.fn(async () => {
    calls++
    if (calls === 1) throw httpError(409, 'conflict')
  })

  queue.clearQueue()
  queue.enqueueAction('receiving_scan', { sessionId: 's1', code: 'Y' })
  await sync.replayOfflineQueue({ post })
  assert.equal(queue.readQueue()[0]?.status, 'conflict')

  const result = await sync.replayOfflineQueue({ post, retryConflicts: true })
  assert.equal(result.synced, 1)
  assert.equal(queue.queueLength(), 0)
})

test('classifySyncError marks 409 permanent and network transient', async () => {
  const sync = await import('./offline-sync')
  assert.equal(sync.classifySyncError(httpError(409, 'x')).permanent, true)
  assert.equal(sync.classifySyncError(httpError(404, 'gone')).permanent, true)
  assert.equal(sync.classifySyncError(httpError(500, 'boom')).permanent, false)
  assert.equal(sync.classifySyncError(new Error('Network Error')).permanent, false)
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
