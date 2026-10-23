/**
 * Gives every order created before order numbers existed a per-tenant number (ORD-1001, ORD-1002, ...),
 * oldest first. Idempotent, safe to re-run and safe while the app is live.
 *
 *   npm run orders:backfill-numbers
 *
 * Runs automatically after db:migrate on start (scripts/start-server.mjs). Requires the same
 * *_DATABASE_URL environment as the app.
 */
import { backfillOrderNumbers } from '../apps/web/lib/server/order-number'

async function main() {
  const { assigned, tenants } = await backfillOrderNumbers()
  console.log(`[order-numbers] numbered ${assigned} order(s) across ${tenants} tenant(s).`)
}

main().then(() => process.exit(0), (err) => {
  console.error(err)
  process.exit(1)
})
