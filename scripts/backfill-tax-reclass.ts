/**
 * PLR-149: move sales tax that was booked as revenue to Sales Tax Payable.
 *
 *   npm run tax:reclass                          # dry run: prints what would be posted, changes nothing
 *   npm run tax:reclass -- --tenant <id>         # limit to one tenant
 *   npm run tax:reclass -- --apply               # posts one correcting entry per invoice
 *
 * Finance should review the dry-run totals before --apply. Safe to run twice.
 * Requires the same *_DATABASE_URL environment as the app (root .env).
 */
import { applyTaxReclass, planTaxReclass } from '../apps/web/lib/server/tax-reclass'

async function main() {
  const apply = process.argv.includes('--apply')
  const ti = process.argv.indexOf('--tenant')
  const tenantId = ti > -1 ? process.argv[ti + 1] : undefined
  const rows = await planTaxReclass(tenantId)
  if (rows.length === 0) {
    console.log('Every taxed invoice already has its tax in Sales Tax Payable. Nothing to do.')
    return
  }
  const byTenant = new Map<string, { invoices: number; total: number }>()
  for (const r of rows) {
    const t = byTenant.get(r.tenantId) ?? { invoices: 0, total: 0 }
    if (Number(r.reclass) > 0) {
      t.invoices++
      t.total += Number(r.reclass)
    }
    byTenant.set(r.tenantId, t)
  }
  console.log(apply ? 'Posting:' : 'DRY RUN - no changes written:')
  console.table([...byTenant].map(([tenant, v]) => ({ tenant, invoices: v.invoices, reclassTotal: v.total.toFixed(2) })))
  const review = rows.filter((r) => r.note)
  if (review.length) {
    console.log('Needs review by hand:')
    console.table(review)
  }
  if (apply) {
    const n = await applyTaxReclass(rows)
    console.log(`Posted ${n} correcting entr${n === 1 ? 'y' : 'ies'}.`)
  } else {
    console.log('Review the totals, then re-run with --apply.')
  }
}

main().then(() => process.exit(0), (err) => {
  console.error(err)
  process.exit(1)
})
