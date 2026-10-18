/**
 * Lightweight in-process background jobs. Started once by the API server.
 */

const SWEEP_INTERVAL_MS = 10 * 60 * 1000
const SALES_CHANNEL_FLUSH_MS = 90 * 1000
/** Webhook retries come due from a minute after a failure, so check often. */
const WEBHOOK_RETRY_MS = 30 * 1000

/** Reconciliation (PLR-150) runs once a day; set RECONCILIATION_DISABLED=1 to turn it off. */
const RECONCILIATION_MS = 24 * 60 * 60 * 1000
const RECONCILIATION_FIRST_RUN_MS = 5 * 60 * 1000

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

  const retryWebhooks = async () => {
    try {
      const { processDueWebhookDeliveries } = await import('./domain-events')
      const res = await processDueWebhookDeliveries()
      if (res.attempted > 0 || res.pruned > 0) {
        console.log(`[jobs] webhooks: attempted ${res.attempted}, pruned ${res.pruned}`)
      }
    } catch (err) {
      console.error('[jobs] webhook retry failed:', err)
    }
  }

  const reconcile = async () => {
    if (process.env.RECONCILIATION_DISABLED === '1') return
    try {
      const { runReconciliationForAllTenants } = await import('./reconciliation')
      const results = await runReconciliationForAllTenants()
      const total = results.reduce((n, r) => n + r.findings.length, 0)
      console.log(`[jobs] reconciliation: ${results.length} tenant(s), ${total} open finding(s)`)
    } catch (err) {
      console.error('[jobs] reconciliation failed:', err)
    }
  }
  const reconcileFirst = setTimeout(() => void reconcile(), RECONCILIATION_FIRST_RUN_MS)
  reconcileFirst.unref?.()
  const reconcileTimer = setInterval(() => void reconcile(), RECONCILIATION_MS)
  reconcileTimer.unref?.()

  void sweep()
  void flushSalesChannels()
  void retryWebhooks()
  const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS)
  timer.unref?.()
  const salesChannelTimer = setInterval(() => void flushSalesChannels(), SALES_CHANNEL_FLUSH_MS)
  salesChannelTimer.unref?.()
  const webhookTimer = setInterval(() => void retryWebhooks(), WEBHOOK_RETRY_MS)
  webhookTimer.unref?.()
}
