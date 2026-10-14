import { paymentDb } from './db'
import { ApiError } from './session'

/** A claim older than this was left by a delivery that crashed; the next delivery takes it over. */
const ABANDONED_AFTER_MS = 5 * 60_000

async function claim(event: { id: string; type: string }): Promise<boolean> {
  try {
    await paymentDb.stripeWebhookEvent.create({ data: { id: event.id, type: event.type } })
    return true
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') return false
    throw e
  }
}

/**
 * Handle a verified Stripe event exactly once. Stripe delivers at least once and retries
 * anything that isn't a 2xx, so:
 * - a redelivery of an event already handled returns 'duplicate' without running `handle`;
 * - a redelivery while another delivery is still handling it gets 409, so Stripe tries later;
 * - if `handle` throws, the claim is dropped and the error rethrown, so the webhook answers 500
 *   and Stripe's retry processes the event again (instead of it being acknowledged and lost).
 */
export async function processStripeEventOnce(
  event: { id: string; type: string },
  handle: () => Promise<unknown>,
): Promise<'processed' | 'duplicate'> {
  if (!(await claim(event))) {
    const row = await paymentDb.stripeWebhookEvent.findUnique({ where: { id: event.id } })
    if (row?.processedAt) return 'duplicate'
    const abandoned = row && Date.now() - row.claimedAt.getTime() > ABANDONED_AFTER_MS
    // Take over an abandoned claim only if no other delivery just did.
    const taken = abandoned
      ? await paymentDb.stripeWebhookEvent.updateMany({
          where: { id: event.id, processedAt: null, claimedAt: row.claimedAt },
          data: { claimedAt: new Date() },
        })
      : { count: 0 }
    if (taken.count !== 1) throw new ApiError(409, 'This event is already being processed')
  }

  try {
    await handle()
  } catch (e) {
    console.error(`[stripe] webhook processing failed for event ${event.id} (${event.type}):`, e)
    await paymentDb.stripeWebhookEvent.delete({ where: { id: event.id } }).catch(() => undefined)
    throw e
  }
  await paymentDb.stripeWebhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } })
  return 'processed'
}
