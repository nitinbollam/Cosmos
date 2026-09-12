/**
 * Lightweight in-process background jobs. Started once by the API server.
 */

const SWEEP_INTERVAL_MS = 10 * 60 * 1000
const SALES_CHANNEL_FLUSH_MS = 90 * 1000

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
    try {
      const { runMarketplaceJobs } = await import('./marketplace-jobs')
      const mp = await runMarketplaceJobs()
      if (mp.auctionsClosed > 0 || mp.escrowsReleased > 0) {
        console.log(`[jobs] marketplace: closed ${mp.auctionsClosed} auction(s), released ${mp.escrowsReleased} escrow(s)`)
      }
    } catch (err) {
      console.error('[jobs] marketplace sweep failed:', err)
    }
    try {
      const { processDueSubscriptions } = await import('./subscriptions')
      const subRes = await processDueSubscriptions()
      if (subRes.processed > 0 || subRes.failed > 0) {
        console.log(`[jobs] subscriptions: processed ${subRes.processed}, failed ${subRes.failed}`)
      }
    } catch (err) {
      console.error('[jobs] subscriptions sweep failed:', err)
    }
    try {
      const { processScheduledCampaigns } = await import('./campaigns')
      const campRes = await processScheduledCampaigns()
      if (campRes.processed > 0 || campRes.failed > 0) {
        console.log(`[jobs] campaigns: processed ${campRes.processed}, failed ${campRes.failed}`)
      }
    } catch (err) {
      console.error('[jobs] campaigns sweep failed:', err)
    }
  }

  const flushSalesChannels = async () => {
    try {
      const { flushAllActiveConnections } = await import('./sales-channels/core')
      const res = await flushAllActiveConnections()
      if (res.pushed > 0 || res.failed > 0) {
        console.log(`[jobs] sales-channels: pushed ${res.pushed}, failed ${res.failed}`)
      }
    } catch (err) {
      console.error('[jobs] sales-channel flush failed:', err)
    }
  }

  void sweep()
  void flushSalesChannels()
  const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS)
  timer.unref?.()
  const salesChannelTimer = setInterval(() => void flushSalesChannels(), SALES_CHANNEL_FLUSH_MS)
  salesChannelTimer.unref?.()
}
