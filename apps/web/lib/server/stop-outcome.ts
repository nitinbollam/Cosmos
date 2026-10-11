/**
 * Outcome rules for delivery stops: why a stop failed, and when a route is done.
 *
 * A failed stop's reason is kept in `RouteStop.pod` under `failure`, next to (or
 * instead of) the delivery evidence, so no schema change is needed. If the stop is
 * delivered later, the earlier failure stays on record.
 *
 * Kept free of DB and session imports so it can be unit-tested on its own.
 */
export type StopFailure = {
  reason: string
  failedAt: string
  failedBy?: string
}

export const MAX_FAILURE_REASON_LENGTH = 500

/** Trimmed reason, or null when none was given. */
export function normalizeFailureReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const reason = raw.trim()
  return reason === '' ? null : reason
}

/** Why a failure reason is not acceptable, or null when it is. */
export function failureReasonProblem(raw: unknown): string | null {
  const reason = normalizeFailureReason(raw)
  if (!reason) return 'A reason is required to mark a stop failed'
  if (reason.length > MAX_FAILURE_REASON_LENGTH) {
    return `The failure reason must be ${MAX_FAILURE_REASON_LENGTH} characters or fewer`
  }
  return null
}

/** The failure recorded on a stop's POD JSON, if any. */
export function failureFromPod(pod: unknown): StopFailure | null {
  if (!pod || typeof pod !== 'object') return null
  const failure = (pod as { failure?: unknown }).failure
  if (!failure || typeof failure !== 'object') return null
  const { reason, failedAt, failedBy } = failure as Record<string, unknown>
  if (typeof reason !== 'string' || typeof failedAt !== 'string') return null
  return { reason, failedAt, ...(typeof failedBy === 'string' ? { failedBy } : {}) }
}

/** POD JSON for a stop being marked failed: keeps what was there, adds the failure. */
export function podWithFailure(existingPod: unknown, failure: StopFailure): Record<string, unknown> {
  const base = existingPod && typeof existingPod === 'object' ? (existingPod as Record<string, unknown>) : {}
  return { ...base, failure }
}

/**
 * POD JSON for a stop being delivered. The `failure` entry is server-owned: one sent
 * by the client is dropped, and a failure recorded earlier on this stop is kept.
 */
export function podForDelivery(existingPod: unknown, submitted: Record<string, unknown> | undefined) {
  const { failure: _clientFailure, ...evidence } = submitted ?? {}
  const earlierFailure = failureFromPod(existingPod)
  return earlierFailure ? { ...evidence, failure: earlierFailure } : evidence
}

/** A route is finished once every stop has an outcome: delivered or failed. */
export function isRouteFinished(stopStatuses: string[]): boolean {
  return stopStatuses.length > 0 && stopStatuses.every((s) => s === 'DELIVERED' || s === 'FAILED')
}
