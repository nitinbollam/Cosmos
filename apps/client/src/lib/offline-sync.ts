import {
  isReplayable,
  patchAction,
  readQueue,
  removeAction,
  replayableCount,
  requestBackgroundSync,
  type OfflineAction,
} from '@/lib/offline-queue'

export type OfflineSyncResult = {
  synced: number
  failed: number
  conflicts: number
  errors: Array<{ id: string; type: string; message: string; permanent: boolean }>
}

type PostFn = (path: string, body?: unknown) => Promise<unknown>

let replayInFlight: Promise<OfflineSyncResult> | null = null

async function defaultPost(path: string, body?: unknown): Promise<unknown> {
  const { api } = await import('@/lib/api-mobile')
  return api.post(path, body)
}

/** Permanent client errors need user action; everything else is retryable. */
export function classifySyncError(err: unknown): { permanent: boolean; message: string; status?: number } {
  const ax = err as {
    message?: string
    response?: { status?: number; data?: { message?: string; error?: string } }
  }
  const status = ax?.response?.status
  const apiMsg = ax?.response?.data?.message ?? ax?.response?.data?.error
  const message =
    (typeof apiMsg === 'string' && apiMsg.trim() ? apiMsg : null) ??
    (typeof ax?.message === 'string' && ax.message.trim() ? ax.message : null) ??
    'Sync failed'

  if (status == null) {
    return { permanent: false, message }
  }
  // 409 conflict / stale resource, 404 gone, 400/422 validation, 403 forbidden, 410 gone
  const permanent = status === 409 || status === 404 || status === 400 || status === 403 || status === 410 || status === 422
  return { permanent, message, status }
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
 * Permanent conflicts stay in the queue with lastError until the user retries or discards.
 * Re-registers Background Sync when replayable items remain.
 */
export async function replayOfflineQueue(opts?: {
  post?: PostFn
  /** When true, also attempt actions previously marked as conflicts. */
  retryConflicts?: boolean
}): Promise<OfflineSyncResult> {
  if (replayInFlight) return replayInFlight

  const post: PostFn = opts?.post ?? defaultPost
  const retryConflicts = opts?.retryConflicts ?? false

  replayInFlight = (async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { synced: 0, failed: 0, conflicts: 0, errors: [] }
    }

    const queue = readQueue()
    let synced = 0
    let failed = 0
    let conflicts = 0
    const errors: OfflineSyncResult['errors'] = []

    for (const action of queue) {
      if (!retryConflicts && !isReplayable(action)) {
        conflicts++
        if (action.lastError) {
          errors.push({
            id: action.id,
            type: action.type,
            message: action.lastError,
            permanent: true,
          })
        }
        continue
      }

      try {
        await replayAction(action, post)
        removeAction(action.id)
        synced++
      } catch (err) {
        const { permanent, message } = classifySyncError(err)
        patchAction(action.id, {
          attempts: (action.attempts ?? 0) + 1,
          lastError: message,
          lastFailedAt: new Date().toISOString(),
          status: permanent ? 'conflict' : 'failed',
        })
        errors.push({ id: action.id, type: action.type, message, permanent })
        if (permanent) conflicts++
        else failed++
      }
    }

    if (replayableCount() > 0) {
      void requestBackgroundSync()
    }

    return { synced, failed, conflicts, errors }
  })().finally(() => {
    replayInFlight = null
  })

  return replayInFlight
}

/**
 * Auto-replay when connectivity returns, when the SW fires Background Sync,
 * and when a backgrounded tab becomes visible again (Safari / no SyncManager).
 * Skips permanent conflicts until the user chooses Retry.
 */
export function registerOfflineSyncListeners(
  onDone?: (result: OfflineSyncResult) => void,
): () => void {
  const run = () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    if (replayableCount() === 0) return
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
