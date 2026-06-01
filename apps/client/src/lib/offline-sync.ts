import { api as mobileApi } from '@/lib/api-mobile'
import { readQueue, removeAction, type OfflineAction } from '@/lib/offline-queue'

async function replayAction(action: OfflineAction): Promise<void> {
  switch (action.type) {
    case 'receiving_session_create': {
      const { poId } = action.payload as { poId?: string }
      await mobileApi.post('/wms/receiving/sessions', { purchaseOrderId: poId || undefined })
      break
    }
    case 'receiving_scan': {
      const { sessionId, code } = action.payload as { sessionId: string; code: string }
      await mobileApi.post(`/wms/receiving/sessions/${sessionId}/scan`, { code, quantity: 1 })
      break
    }
    case 'wms_tasks_refresh':
    case 'dispatch_routes_refresh':
      break
    default:
      throw new Error(`Unknown offline action: ${action.type}`)
  }
}

export async function replayOfflineQueue(): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) return { synced: 0, failed: 0 }
  const queue = readQueue()
  let synced = 0
  let failed = 0
  for (const action of queue) {
    try {
      await replayAction(action)
      removeAction(action.id)
      synced++
    } catch {
      failed++
    }
  }
  return { synced, failed }
}

export function registerOfflineSyncListeners(onDone?: (result: { synced: number; failed: number }) => void) {
  const run = () => {
    if (!navigator.onLine) return
    void replayOfflineQueue().then(onDone)
  }
  window.addEventListener('online', run)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev.data?.type === 'COSMOS_SYNC_QUEUE') run()
    })
  }
  run()
  return () => window.removeEventListener('online', run)
}
