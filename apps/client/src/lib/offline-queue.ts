const STORAGE_KEY = 'pleros.offlineQueue'

/** Background Sync tag — must match `sw.js` sync listener. */
export const OFFLINE_SYNC_TAG = 'pleros-offline-queue'

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

/**
 * Ask the browser to wake the service worker when connectivity returns
 * so queued actions can replay without a user tap.
 */
export async function requestBackgroundSync(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false
  try {
    const reg = await navigator.serviceWorker.ready
    const syncManager = (
      reg as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> }
      }
    ).sync
    if (syncManager) {
      await syncManager.register(OFFLINE_SYNC_TAG)
      return true
    }
    // Fallback: ask SW to register (or notify open clients immediately)
    reg.active?.postMessage({ type: 'PLEROS_REGISTER_SYNC' })
    return false
  } catch {
    /* SyncManager unsupported / denied — online + visibility listeners still replay */
    return false
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
