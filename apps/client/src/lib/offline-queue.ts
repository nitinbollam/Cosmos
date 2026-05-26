const STORAGE_KEY = 'cosmos.offlineQueue'

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

export function enqueueAction(type: string, payload: unknown): void {
  const q = readQueue()
  q.push({
    id: crypto.randomUUID(),
    type,
    payload,
    createdAt: new Date().toISOString(),
  })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(q))
}

export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY)
}
