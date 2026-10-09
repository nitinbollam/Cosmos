import * as budgets from '../budgets'
import { ApiError, requirePermission } from './common'

export async function routeBudgets(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requirePermission(req, method === 'GET' ? 'budgets.read' : 'budgets.write')
  const url = new URL(req.url)

  if (seg.length === 1 && method === 'GET') {
    const year = url.searchParams.get('fiscalYear')
    return Response.json(
      await budgets.listBudgets(session.tenantId, year ? parseInt(year, 10) : undefined),
    )
  }

  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as { name?: string; fiscalYear?: number }
    if (!body.name || body.fiscalYear == null) throw new ApiError(400, 'name and fiscalYear required')
    return Response.json(await budgets.createBudget(session.tenantId, { name: body.name, fiscalYear: body.fiscalYear }), {
      status: 201,
    })
  }

  if (seg.length === 2 && method === 'GET') {
    return Response.json(await budgets.getBudget(session.tenantId, seg[1]!))
  }

  if (seg.length === 3 && seg[2] === 'lines' && (method === 'PUT' || method === 'POST')) {
    const body = (await req.json()) as {
      lines?: Array<{ accountId: string; month: number; budgetedAmount: number }>
    }
    if (!body.lines?.length) throw new ApiError(400, 'lines required')
    await budgets.upsertBudgetLines(session.tenantId, seg[1]!, body.lines)
    return Response.json(await budgets.getBudget(session.tenantId, seg[1]!))
  }

  if (seg.length === 3 && seg[2] === 'vs-actual' && method === 'GET') {
    return Response.json(await budgets.getBudgetVsActual(session.tenantId, seg[1]!))
  }

  throw new ApiError(404, 'Budget route not found')
}
