const STORAGE_KEY = 'pleros.offlineQueue'

export type OfflineAction = {
  id: string
  type: string
  payload: unknown
  createdAt: string
}

export function readQueue(): OfflineAction[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as OfflineAction[]) : []
  } catch {
    return []
  }
}

function writeQueue(q: OfflineAction[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(q))
}

async function requestBackgroundSync(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.ready
    const syncManager = (
      reg as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> }
      }
    ).sync
    if (syncManager) {
      await syncManager.register('pleros-offline-queue')
      return
    }
    reg.active?.postMessage({ type: 'PLEROS_REGISTER_SYNC' })
  } catch {
    /* SyncManager unsupported — online listener still replays the queue */
  }
}

export function enqueueAction(type: string, payload: unknown): void {
  const q = readQueue()
  q.push({
    id: crypto.randomUUID(),
    type,
    payload,
    createdAt: new Date().toISOString(),
  })
  writeQueue(q)
  window.dispatchEvent(new CustomEvent('pleros-offline-queue-changed'))
  void requestBackgroundSync()
}

export function removeAction(id: string): void {
  writeQueue(readQueue().filter((a) => a.id !== id))
  window.dispatchEvent(new CustomEvent('pleros-offline-queue-changed'))
}

export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent('pleros-offline-queue-changed'))
}

export function queueLength(): number {
  return readQueue().length
}
