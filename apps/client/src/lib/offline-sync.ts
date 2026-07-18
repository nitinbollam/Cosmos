import {
  queueLength,
  readQueue,
  removeAction,
  requestBackgroundSync,
  type OfflineAction,
} from '@/lib/offline-queue'

export type OfflineSyncResult = { synced: number; failed: number }

type PostFn = (path: string, body?: unknown) => Promise<unknown>

let replayInFlight: Promise<OfflineSyncResult> | null = null

async function defaultPost(path: string, body?: unknown): Promise<unknown> {
  const { api } = await import('@/lib/api-mobile')
  return api.post(path, body)
}

async function replayAction(action: OfflineAction, post: PostFn): Promise<void> {
  switch (action.type) {
    case 'receiving_session_create': {
      const { poId } = action.payload as { poId?: string }
      await post('/wms/receiving/sessions', { purchaseOrderId: poId || undefined })
      break
    }
    case 'receiving_scan': {
      const { sessionId, code } = action.payload as { sessionId: string; code: string }
      await post(`/wms/receiving/sessions/${sessionId}/scan`, { code, quantity: 1 })
      break
    }
    case 'wms_tasks_refresh':
    case 'dispatch_routes_refresh':
      break
    default:
      throw new Error(`Unknown offline action: ${action.type}`)
  }
}

/**
 * Drain the offline queue while online. Concurrent callers share one in-flight run.
 * Re-registers Background Sync when items remain so Chromium will retry later.
 */
export async function replayOfflineQueue(opts?: { post?: PostFn }): Promise<OfflineSyncResult> {
  if (replayInFlight) return replayInFlight

  const post: PostFn = opts?.post ?? defaultPost

  replayInFlight = (async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { synced: 0, failed: 0 }
    }

    const queue = readQueue()
    let synced = 0
    let failed = 0
    for (const action of queue) {
      try {
        await replayAction(action, post)
        removeAction(action.id)
        synced++
      } catch {
        failed++
      }
    }

    if (queueLength() > 0) {
      void requestBackgroundSync()
    }

    return { synced, failed }
  })().finally(() => {
    replayInFlight = null
  })

  return replayInFlight
}

/**
 * Auto-replay when connectivity returns, when the SW fires Background Sync,
 * and when a backgrounded tab becomes visible again (Safari / no SyncManager).
 */
export function registerOfflineSyncListeners(
  onDone?: (result: OfflineSyncResult) => void,
): () => void {
  const run = () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    if (queueLength() === 0) return
    void replayOfflineQueue().then((result) => {
      onDone?.(result)
    })
  }

  const onOnline = () => run()
  const onVisibility = () => {
    if (document.visibilityState === 'visible') run()
  }
  const onPageShow = () => run()
  const onSwMessage = (ev: MessageEvent) => {
    if (ev.data?.type === 'PLEROS_SYNC_QUEUE') run()
  }

  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pageshow', onPageShow)

  let swListening = false
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', onSwMessage)
    swListening = true
  }

  run()

  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pageshow', onPageShow)
    if (swListening) {
      navigator.serviceWorker.removeEventListener('message', onSwMessage)
    }
  }
}
