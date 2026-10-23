import { listOpenFindings, reportReconciliation, runReconciliation } from '../reconciliation'
import { requirePermission } from './common'

/** PLR-150: reconciliation findings for the caller's tenant. */
export async function routeReconciliation(method: string, seg: string[], req: Request): Promise<Response> {
  if (seg.length === 2 && seg[1] === 'findings' && method === 'GET') {
    const session = await requirePermission(req, 'finance.read')
    const url = new URL(req.url)
    const limit = Number(url.searchParams.get('limit') ?? 200)
    return Response.json(
      await listOpenFindings(session.tenantId, {
        ruleId: url.searchParams.get('ruleId') ?? undefined,
        limit: Number.isFinite(limit) ? limit : 200,
      }),
    )
  }

  if (seg.length === 2 && seg[1] === 'run' && method === 'POST') {
    const session = await requirePermission(req, 'finance.write')
    const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean }
    const result = await runReconciliation(session.tenantId, { dryRun: body.dryRun === true })
    if (!result.dryRun) reportReconciliation(result)
    return Response.json({
      dryRun: result.dryRun,
      byRule: result.byRule,
      newFindings: result.newFindings.length,
      resolved: result.resolved,
      ruleErrors: result.ruleErrors,
    })
  }

  return Response.json({ error: 'Reconciliation route not found' }, { status: 404 })
}
