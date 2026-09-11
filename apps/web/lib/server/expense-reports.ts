import { Prisma } from '@/generated/prisma-ledger'
import { ExpenseReportStatus } from '@/generated/prisma-ledger'
import { ApprovalType } from '@/generated/prisma-tenant'
import { ledgerDb } from './db'
import { ApiError } from './session'
import { createApprovalRequest } from './approvals'
import { getTenantFinanceSettings } from './tenant-finance-settings'
import { postExpenseApprovalJournal, postExpensePaidJournal } from './expense-gl'
import { auditLog } from './audit-log'

export type CreateExpenseLineInput = {
  category: string
  amount: number
  description: string
  incurredAt: string
  receiptUrl?: string
}

async function recomputeTotal(reportId: string) {
  const lines = await ledgerDb.expenseLine.findMany({ where: { expenseReportId: reportId } })
  const total = lines.reduce((sum, l) => sum + Number(l.amount), 0)
  await ledgerDb.expenseReport.update({
    where: { id: reportId },
    data: { totalAmount: new Prisma.Decimal(total) },
  })
  return total
}

async function getReport(tenantId: string, reportId: string, userId?: string) {
  const report = await ledgerDb.expenseReport.findFirst({
    where: { id: reportId, tenantId, ...(userId ? { userId } : {}) },
    include: { lines: { orderBy: { incurredAt: 'asc' } } },
  })
  if (!report) throw new ApiError(404, 'Expense report not found')
  return report
}

export async function createExpenseReport(tenantId: string, userId: string) {
  return ledgerDb.expenseReport.create({
    data: { tenantId, userId, status: ExpenseReportStatus.DRAFT },
    include: { lines: true },
  })
}

export async function listExpenseReports(tenantId: string, userId?: string) {
  return ledgerDb.expenseReport.findMany({
    where: { tenantId, ...(userId ? { userId } : {}) },
    include: { lines: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function addExpenseLine(tenantId: string, reportId: string, line: CreateExpenseLineInput, userId?: string) {
  const report = await getReport(tenantId, reportId, userId)
  if (report.status !== ExpenseReportStatus.DRAFT) throw new ApiError(400, 'Only draft reports can be edited')
  if (line.amount <= 0) throw new ApiError(400, 'Amount must be positive')

  const created = await ledgerDb.expenseLine.create({
    data: {
      expenseReportId: reportId,
      category: line.category.trim(),
      amount: new Prisma.Decimal(line.amount),
      description: line.description.trim(),
      incurredAt: new Date(line.incurredAt),
      receiptUrl: line.receiptUrl?.trim() || null,
    },
  })
  await recomputeTotal(reportId)
  return created
}

export async function removeExpenseLine(tenantId: string, reportId: string, lineId: string, userId?: string) {
  const report = await getReport(tenantId, reportId, userId)
  if (report.status !== ExpenseReportStatus.DRAFT) throw new ApiError(400, 'Only draft reports can be edited')
  await ledgerDb.expenseLine.deleteMany({ where: { id: lineId, expenseReportId: reportId } })
  await recomputeTotal(reportId)
}

export async function submitExpenseReport(tenantId: string, reportId: string, userId?: string) {
  const report = await getReport(tenantId, reportId, userId)
  if (report.status !== ExpenseReportStatus.DRAFT) throw new ApiError(400, 'Report already submitted')
  if (!report.lines.length) throw new ApiError(400, 'Add at least one expense line')

  const total = Number(report.totalAmount)
  const { expenseApprovalThreshold } = await getTenantFinanceSettings(tenantId)
  const now = new Date()

  if (total > expenseApprovalThreshold) {
    await createApprovalRequest(tenantId, {
      type: ApprovalType.EXPENSE_REPORT,
      subjectId: reportId,
      requestedBy: report.userId,
      context: {
        total,
        lineCount: report.lines.length,
        lines: report.lines.map((l) => ({
          category: l.category,
          amount: Number(l.amount),
          description: l.description,
          incurredAt: l.incurredAt.toISOString(),
        })),
      },
    })
    return ledgerDb.expenseReport.update({
      where: { id: reportId },
      data: { status: ExpenseReportStatus.PENDING_APPROVAL, submittedAt: now },
      include: { lines: true },
    })
  }

  const journalEntryId = await postExpenseApprovalJournal(tenantId, reportId, total)
  return ledgerDb.expenseReport.update({
    where: { id: reportId },
    data: {
      status: ExpenseReportStatus.APPROVED,
      submittedAt: now,
      decidedAt: now,
      journalEntryId,
    },
    include: { lines: true },
  })
}

export async function decideExpenseReport(
  tenantId: string,
  reportId: string,
  decision: { approve: boolean; decidedBy: string; rejectReason?: string },
) {
  const report = await getReport(tenantId, reportId)
  if (report.status !== ExpenseReportStatus.PENDING_APPROVAL) {
    throw new ApiError(400, 'Expense report is not pending approval')
  }

  if (!decision.approve) {
    return ledgerDb.expenseReport.update({
      where: { id: reportId },
      data: {
        status: ExpenseReportStatus.REJECTED,
        decidedAt: new Date(),
        rejectReason: decision.rejectReason?.trim() || 'Rejected',
      },
      include: { lines: true },
    })
  }

  const total = Number(report.totalAmount)
  const journalEntryId = await postExpenseApprovalJournal(tenantId, reportId, total)
  return ledgerDb.expenseReport.update({
    where: { id: reportId },
    data: {
      status: ExpenseReportStatus.APPROVED,
      decidedAt: new Date(),
      journalEntryId,
    },
    include: { lines: true },
  })
}

export async function markExpenseReportPaid(tenantId: string, reportId: string) {
  const report = await getReport(tenantId, reportId)
  if (report.status !== ExpenseReportStatus.APPROVED) {
    throw new ApiError(400, 'Only approved expense reports can be marked paid')
  }
  const total = Number(report.totalAmount)
  await postExpensePaidJournal(tenantId, reportId, total)
  return ledgerDb.expenseReport.update({
    where: { id: reportId },
    data: { status: ExpenseReportStatus.PAID },
    include: { lines: true },
  })
}

export async function adjustExpenseReportAdmin(
  tenantId: string,
  reportId: string,
  input: { reason: string; actorId: string },
) {
  await auditLog(tenantId, {
    action: 'expense-report.adjust',
    entityType: 'ExpenseReport',
    entityId: reportId,
    userId: input.actorId,
    metadata: { reason: input.reason },
  })
  return getReport(tenantId, reportId)
}
