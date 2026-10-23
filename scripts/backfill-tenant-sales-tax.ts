/**
 * PLR-154: make the historical 7% sales tax explicit for tenants that never configured a rate.
 *
 *   npm run tax:backfill              # dry run: prints the impact report, changes nothing
 *   npm run tax:backfill -- --apply   # writes the rate (unconfirmed) so totals do not change
 *
 * Requires the same *_DATABASE_URL environment as the app (root .env).
 */
import { backfillTenantSalesTax } from '../apps/web/lib/server/tenant-tax-backfill'

async function main() {
  const apply = process.argv.includes('--apply')
  const rows = await backfillTenantSalesTax({ dryRun: !apply })
  if (rows.length === 0) {
    console.log('All tenants already have an explicit sales tax rate. Nothing to do.')
    return
  }
  console.log(apply ? 'Applied (rate written as UNCONFIRMED):' : 'DRY RUN - no changes written:')
  console.table(rows)
  if (!apply) console.log('Review the report, then re-run with --apply.')
}

main().then(() => process.exit(0), (err) => {
  console.error(err)
  process.exit(1)
})
