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
