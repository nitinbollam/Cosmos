/**
 * Fixes POS registers that share a name within a company. Nothing is deleted.
 *
 *   npm run pos:dedupe-registers             # dry run: prints what would change, changes nothing
 *   npm run pos:dedupe-registers -- --apply  # applies it
 *
 * An unused duplicate is deactivated; a duplicate with shifts or till sessions is renamed "Name (2)".
 * Safe to re-run. Requires the same *_DATABASE_URL environment as the app.
 */
import { dedupePosRegisters } from '../apps/web/lib/server/pos-register-dedupe'

async function main() {
  const apply = process.argv.includes('--apply')
  const actions = await dedupePosRegisters({ apply })
  if (actions.length === 0) {
    console.log('No duplicate register names. Nothing to do.')
    return
  }
  console.log(apply ? 'Applied:' : 'DRY RUN - no changes written:')
  console.table(
    actions.map((a) => ({
      tenant: a.tenantId,
      register: a.name,
      action: a.kind === 'deactivate' ? 'deactivate (never used)' : `rename to "${a.newName}"`,
      id: a.id,
    })),
  )
  if (!apply) console.log('Review the list, then re-run with --apply.')
}

main().then(() => process.exit(0), (err) => {
  console.error(err)
  process.exit(1)
})
