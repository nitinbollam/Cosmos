const STORAGE_KEY = 'pleros.offlineQueue'

/** Background Sync tag — must match `sw.js` sync listener. */
export const OFFLINE_SYNC_TAG = 'pleros-offline-queue'

export type OfflineActionStatus = 'pending' | 'failed' | 'conflict'

export type OfflineAction = {
  id: string
  type: string
  payload: unknown
  createdAt: string
  /** Replay attempts that ended in error (successful sync removes the action). */
  attempts?: number
  lastError?: string
  lastFailedAt?: string
  /**
   * `pending` — not yet tried or cleared for retry
   * `failed` — transient error (network / 5xx); auto-retry
   * `conflict` — permanent client error (409/404/…); needs user retry or discard
   */
  status?: OfflineActionStatus
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

function notifyQueueChanged(): void {
  window.dispatchEvent(new CustomEvent('pleros-offline-queue-changed'))
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
    status: 'pending',
  })
  writeQueue(q)
  notifyQueueChanged()
  void requestBackgroundSync()
}

export function removeAction(id: string): void {
  writeQueue(readQueue().filter((a) => a.id !== id))
  notifyQueueChanged()
}

export function patchAction(id: string, patch: Partial<OfflineAction>): void {
  const q = readQueue()
  const idx = q.findIndex((a) => a.id === id)
  if (idx < 0) return
  q[idx] = { ...q[idx]!, ...patch, id: q[idx]!.id }
  writeQueue(q)
  notifyQueueChanged()
}

export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY)
  notifyQueueChanged()
}

export function queueLength(): number {
  return readQueue().length
}

export function isReplayable(action: OfflineAction): boolean {
  return action.status !== 'conflict'
}

/** Actions that can be auto-retried (not permanent conflicts). */
export function replayableCount(queue = readQueue()): number {
  return queue.filter(isReplayable).length
}

export function conflictCount(queue = readQueue()): number {
  return queue.filter((a) => a.status === 'conflict').length
}

export function failedCount(queue = readQueue()): number {
  return queue.filter((a) => a.status === 'failed' || a.status === 'conflict').length
}

/** Remove permanent + transient failures so the user can move on. */
export function discardFailedActions(): number {
  const before = readQueue()
  const next = before.filter((a) => a.status !== 'failed' && a.status !== 'conflict')
  const removed = before.length - next.length
  if (removed > 0) {
    writeQueue(next)
    notifyQueueChanged()
  }
  return removed
}

/** Clear errors and mark conflicts/failures pending so the user can force another sync. */
export function resetFailedForRetry(): number {
  const q = readQueue()
  let n = 0
  for (let i = 0; i < q.length; i++) {
    const a = q[i]!
    if (a.status === 'failed' || a.status === 'conflict') {
      q[i] = {
        ...a,
        status: 'pending',
        lastError: undefined,
        lastFailedAt: undefined,
      }
      n++
    }
  }
  if (n > 0) {
    writeQueue(q)
    notifyQueueChanged()
  }
  return n
}

export function actionLabel(type: string): string {
  switch (type) {
    case 'receiving_session_create':
      return 'Start receiving session'
    case 'receiving_scan':
      return 'Receiving scan'
    case 'wms_tasks_refresh':
      return 'Refresh warehouse tasks'
    case 'dispatch_routes_refresh':
      return 'Refresh delivery routes'
    default:
      return type.replace(/_/g, ' ')
  }
}
