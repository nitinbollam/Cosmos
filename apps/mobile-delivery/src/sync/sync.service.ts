import NetInfo from '@react-native-community/netinfo'
import * as SecureStore from 'expo-secure-store'
import { dispatchClient } from '../api/dispatch.client'

interface QueuedAction {
  id: string
  action: string
  payload: string
  retryCount: number
  createdAt: string
}

const QUEUE_KEY = 'cosmos_delivery_offline_queue'

async function loadQueue(): Promise<QueuedAction[]> {
  try {
    const raw = await SecureStore.getItemAsync(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as QueuedAction[]) : []
  } catch {
    return []
  }
}

async function saveQueue(q: QueuedAction[]): Promise<void> {
  await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(q))
}

export const syncService = {
  async queueAction(action: string, payload: object): Promise<void> {
    const q = await loadQueue()
    q.push({
      id: Math.random().toString(36).slice(2),
      action,
      payload: JSON.stringify(payload),
      retryCount: 0,
      createdAt: new Date().toISOString(),
    })
    await saveQueue(q)
  },

  async flushQueue(token: string | null, tenantId: string | null): Promise<void> {
    const q = await loadQueue()
    const remaining: QueuedAction[] = []

    for (const item of q) {
      try {
        const payload = JSON.parse(item.payload) as object
        await dispatchClient.replayAction(token, tenantId, item.action, payload)
      } catch {
        if (item.retryCount < 5) {
          remaining.push({ ...item, retryCount: item.retryCount + 1 })
        }
      }
    }

    await saveQueue(remaining)
  },

  async syncWhenOnline(token: string | null, tenantId: string | null): Promise<void> {
    const net = await NetInfo.fetch()
    if (!net.isConnected) return
    await syncService.flushQueue(token, tenantId)
  },
}
