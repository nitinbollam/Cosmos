import assert from 'node:assert/strict'
import test, { afterEach, beforeEach, mock } from 'node:test'

type SyncRegister = (tag: string) => Promise<void>

const memory = new Map<string, string>()

function installBrowserMocks(opts?: { syncRegister?: SyncRegister; hasSync?: boolean }) {
  memory.clear()
  const postMessage = mock.fn()
  const syncRegister = mock.fn(opts?.syncRegister ?? (async () => undefined))
  const hasSync = opts?.hasSync ?? true

  const localStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value)
    },
    removeItem: (key: string) => {
      memory.delete(key)
    },
  }

  const registration = {
    active: { postMessage },
    sync: hasSync ? { register: syncRegister } : undefined,
  }

  const serviceWorker = {
    ready: Promise.resolve(registration),
    addEventListener: mock.fn(),
    removeEventListener: mock.fn(),
  }

  const windowObj = {
    localStorage,
    dispatchEvent: mock.fn(() => true),
    addEventListener: mock.fn(),
    removeEventListener: mock.fn(),
  }

  Object.defineProperty(globalThis, 'window', { value: windowObj, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorage,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'navigator', {
    value: { serviceWorker, onLine: true },
    configurable: true,
    writable: true,
  })

  return { postMessage, syncRegister, windowObj, serviceWorker }
}

beforeEach(() => {
  installBrowserMocks()
})

afterEach(() => {
  mock.restoreAll()
})

test('enqueueAction persists action and registers Background Sync', async () => {
  const { syncRegister, windowObj } = installBrowserMocks()
  const mod = await import('./offline-queue')

  mod.clearQueue()
  mod.enqueueAction('receiving_scan', { sessionId: 's1', code: 'SKU-1' })

  const queue = mod.readQueue()
  assert.equal(queue.length, 1)
  assert.equal(queue[0]?.type, 'receiving_scan')
  assert.deepEqual(queue[0]?.payload, { sessionId: 's1', code: 'SKU-1' })
  assert.equal(typeof queue[0]?.id, 'string')
  assert.equal(windowObj.dispatchEvent.mock.calls.length >= 1, true)

  // Background Sync registration is async
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(syncRegister.mock.calls.length, 1)
  assert.equal(syncRegister.mock.calls[0]?.arguments[0], mod.OFFLINE_SYNC_TAG)
})

test('requestBackgroundSync falls back to SW postMessage when SyncManager missing', async () => {
  const { postMessage, syncRegister } = installBrowserMocks({ hasSync: false })
  const mod = await import('./offline-queue')

  const registered = await mod.requestBackgroundSync()
  assert.equal(registered, false)
  assert.equal(syncRegister.mock.calls.length, 0)
  assert.equal(postMessage.mock.calls.length, 1)
  assert.deepEqual(postMessage.mock.calls[0]?.arguments[0], { type: 'PLEROS_REGISTER_SYNC' })
})

test('requestBackgroundSync returns true when SyncManager.register succeeds', async () => {
  const { syncRegister } = installBrowserMocks({ hasSync: true })
  const mod = await import('./offline-queue')

  const registered = await mod.requestBackgroundSync()
  assert.equal(registered, true)
  assert.equal(syncRegister.mock.calls[0]?.arguments[0], 'pleros-offline-queue')
})

test('removeAction and clearQueue update storage', async () => {
  installBrowserMocks()
  const mod = await import('./offline-queue')

  mod.clearQueue()
  mod.enqueueAction('receiving_session_create', { poId: 'po1' })
  const id = mod.readQueue()[0]!.id
  assert.equal(mod.queueLength(), 1)

  mod.removeAction(id)
  assert.equal(mod.queueLength(), 0)

  mod.enqueueAction('wms_tasks_refresh', {})
  mod.clearQueue()
  assert.equal(mod.readQueue().length, 0)
})
