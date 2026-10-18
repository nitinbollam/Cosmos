/**
 * PLR-150: run the cross-database reconciliation from the command line.
 *
 *   npm run reconcile -- --tenant <id> --dry     # print findings, write nothing
 *   npm run reconcile -- --tenant <id>           # record findings
 *   npm run reconcile -- --all                   # every tenant
 *
 * Requires the same *_DATABASE_URL environment as the app (root .env). Read-only for business data.
 */
import {
  RULE_DESCRIPTIONS,
  reportReconciliation,
  runReconciliation,
  runReconciliationForAllTenants,
  type ReconcileResult,
} from '../apps/web/lib/server/reconciliation'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function print(r: ReconcileResult) {
  console.log(`\nTenant ${r.tenantId}${r.dryRun ? ' (dry run)' : ''}`)
  console.table(
    Object.entries(r.byRule).map(([rule, count]) => ({ rule, count, description: RULE_DESCRIPTIONS[rule as keyof typeof RULE_DESCRIPTIONS] })),
  )
  for (const f of r.findings.slice(0, 50)) console.log(`${f.ruleId} ${f.entityType} ${f.entityId} ${JSON.stringify(f.details)}`)
  if (r.findings.length > 50) console.log(`... ${r.findings.length - 50} more`)
  for (const [rule, msg] of Object.entries(r.ruleErrors)) console.error(`Rule ${rule} failed: ${msg}`)
}

async function main() {
  const dry = process.argv.includes('--dry')
  const tenant = arg('tenant')
  if (process.argv.includes('--all')) {
    if (dry) throw new Error('--dry is per tenant: use --tenant <id> --dry')
    for (const r of await runReconciliationForAllTenants()) print(r)
    return
  }
  if (!tenant) throw new Error('Usage: npm run reconcile -- --tenant <id> [--dry] | --all')
  const r = await runReconciliation(tenant, { dryRun: dry })
  print(r)
  if (!dry) reportReconciliation(r)
}

main().then(() => process.exit(0), (err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
