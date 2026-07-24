/**
 * Lightweight in-process background jobs. Started once by the API server.
 */

const SWEEP_INTERVAL_MS = 10 * 60 * 1000

let started = false

export function startBackgroundJobs(): void {
  if (started) return
  started = true

  const sweep = async () => {
    try {
      const { releaseExpiredReservations } = await import('./inventory')
      const { released } = await releaseExpiredReservations()
      if (released > 0) console.log(`[jobs] released ${released} expired stock reservation(s)`)
    } catch (err) {
      console.error('[jobs] reservation sweep failed:', err)
    }
  }

  void sweep()
  const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS)
  timer.unref?.()
}
