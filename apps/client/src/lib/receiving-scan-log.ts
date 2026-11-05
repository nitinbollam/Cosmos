/**
 * The running list of scans on mobile receiving.
 *
 * Only the latest scans are listed. A large receipt runs to hundreds of scans on a low-end warehouse phone, and older
 * rows are history, not feedback; the totals still count every one. Scans the server refused (an unknown code, a
 * misread label) are kept apart and only the last few, so a run of failures can't push received scans out of the
 * list (ClickUp 45).
 */

export type ScanStatus = 'sent' | 'queued' | 'error'

export type ScanEntry = {
  id: number
  code: string
  status: ScanStatus
  source: string
  detail?: string
}

export type ScanLog = {
  /** Sent and queued scans, newest first. */
  recent: ScanEntry[]
  /** Refused scans, newest first. */
  failed: ScanEntry[]
  totals: Record<ScanStatus, number>
}

export const RECENT_LIMIT = 50
export const FAILED_LIMIT = 5

export const EMPTY_SCAN_LOG: ScanLog = { recent: [], failed: [], totals: { sent: 0, queued: 0, error: 0 } }

export function recordScan(log: ScanLog, entry: ScanEntry): ScanLog {
  const totals = { ...log.totals, [entry.status]: log.totals[entry.status] + 1 }
  return entry.status === 'error'
    ? { ...log, failed: [entry, ...log.failed].slice(0, FAILED_LIMIT), totals }
    : { ...log, recent: [entry, ...log.recent].slice(0, RECENT_LIMIT), totals }
}
