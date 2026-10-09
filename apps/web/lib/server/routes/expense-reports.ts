import * as expenseReports from '../expense-reports'
import { persistExpenseReceipt, readExpenseReceipt } from '../expense-upload'
import { ApiError, hasPermission, requirePermission, requireSession } from './common'

export async function routeExpenseReports(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg.length === 2 && seg[1] === 'receipts' && method === 'POST') {
    const body = (await req.json()) as { fileName?: string; contentBase64?: string; mimeType?: string }
    if (!body.contentBase64) throw new ApiError(400, 'contentBase64 required')
    const url = await persistExpenseReceipt(session.tenantId, {
      fileName: body.fileName ?? 'receipt',
      contentBase64: body.contentBase64,
      mimeType: body.mimeType,
    })
    return Response.json({ url }, { status: 201 })
  }

  if (seg.length >= 3 && seg[1] === 'receipts' && method === 'GET') {
    if (seg[2] !== session.tenantId && session.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'Forbidden: cannot access receipts from another organization')
    }
    const relative = seg.slice(2).join('/')
    const file = readExpenseReceipt(relative)
    if (!file) throw new ApiError(404, 'Receipt not found')
    return new Response(file.buf, { headers: { 'Content-Type': file.mime } })
  }

  if (seg.length === 1 && method === 'GET') {
    const selfOnly = !hasPermission(session, 'expense-reports.read')
    if (selfOnly) {
      return Response.json(await expenseReports.listExpenseReports(session.tenantId, session.userId))
    }
    await requirePermission(req, 'expense-reports.read')
    return Response.json(await expenseReports.listExpenseReports(session.tenantId))
  }

  if (seg.length === 1 && method === 'POST') {
    return Response.json(await expenseReports.createExpenseReport(session.tenantId, session.userId), { status: 201 })
  }

  if (seg.length === 2 && method === 'GET') {
    const selfOnly = !hasPermission(session, 'expense-reports.read')
    const row = await expenseReports.getExpenseReport(
      session.tenantId,
      seg[1],
      selfOnly ? session.userId : undefined,
    )
    return Response.json(row)
  }

  if (seg.length === 3 && seg[2] === 'lines' && method === 'POST') {
    const body = (await req.json()) as expenseReports.CreateExpenseLineInput
    return Response.json(
      await expenseReports.addExpenseLine(session.tenantId, seg[1]!, body, session.userId),
      { status: 201 },
    )
  }

  if (seg.length === 4 && seg[2] === 'lines' && method === 'DELETE') {
    await expenseReports.removeExpenseLine(session.tenantId, seg[1]!, seg[3]!, session.userId)
    return new Response(null, { status: 204 })
  }

  if (seg.length === 3 && seg[2] === 'submit' && method === 'POST') {
    return Response.json(await expenseReports.submitExpenseReport(session.tenantId, seg[1]!, session.userId))
  }

  if (seg.length === 3 && seg[2] === 'paid' && method === 'POST') {
    await requirePermission(req, 'expense-reports.write')
    return Response.json(await expenseReports.markExpenseReportPaid(session.tenantId, seg[1]!))
  }

  throw new ApiError(404, 'Expense report route not found')
}
