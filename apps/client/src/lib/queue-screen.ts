import type { OfflineAction } from '@/lib/offline-queue'

export type QueueRow = {
  id: string
  label: string
  kind: 'conflict' | 'failed' | 'waiting'
  detail: string
  attempts: number
  queuedAt: string
}

export function ageLabel(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
  if (!Number.isFinite(mins)) return ''
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

const kindOf = (a: OfflineAction): QueueRow['kind'] => (a.status === 'conflict' ? 'conflict' : a.status === 'failed' ? 'failed' : 'waiting')

const WORDS: Record<QueueRow['kind'], string> = {
  conflict: 'The server refused this. Retry it or discard it.',
  failed: 'Could not send yet. It will retry.',
  waiting: 'Waiting to send.',
}

/** What to show: things that need a decision first, then what is just waiting; oldest first within each. */
export function queueRows(queue: OfflineAction[], label: (type: string) => string, now = Date.now()): QueueRow[] {
  const order = { conflict: 0, failed: 1, waiting: 2 } as const
  return queue
    .map((a) => ({
      id: a.id,
      label: label(a.type),
      kind: kindOf(a),
      detail: a.lastError?.trim() || WORDS[kindOf(a)],
      attempts: a.attempts ?? 0,
      queuedAt: ageLabel(a.createdAt, now),
      _t: new Date(a.createdAt).getTime(),
    }))
    .sort((x, y) => order[x.kind] - order[y.kind] || x._t - y._t)
    .map(({ _t, ...row }) => row)
}

export const needsAttention = (rows: QueueRow[]) => rows.filter((r) => r.kind !== 'waiting').length
