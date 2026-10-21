import { Prisma } from '@/generated/prisma-ledger'
import { ExpenseReportStatus } from '@/generated/prisma-ledger'
import { ApprovalType } from '@/generated/prisma-tenant'
import { ledgerDb } from './db'
import { ApiError } from './session'
import { createApprovalRequest } from './approvals'
import { getTenantFinanceSettings } from './tenant-finance-settings'
import { auditLog } from './audit-log'
import { formatMoney } from './money'
import { enqueuePostingJobAfterCommit } from './posting-outbox'

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

/**
 * Moves a report from `from` to `to` only if nobody moved it first, so two approvers (or a double
 * click) produce one transition and one journal. The loser gets 409.
 */
async function transitionReport(
  tenantId: string,
  reportId: string,
  from: ExpenseReportStatus,
  data: Prisma.ExpenseReportUpdateManyMutationInput & { status: ExpenseReportStatus },
) {
  const moved = await ledgerDb.expenseReport.updateMany({ where: { id: reportId, tenantId, status: from }, data })
  if (moved.count !== 1) throw new ApiError(409, 'Expense report was just changed by someone else — reload and try again')
  return getReport(tenantId, reportId)
}

/** Dr Employee Expenses, Cr Reimbursements Payable, posted by the outbox worker. */
async function queueApprovalJournal(tenantId: string, reportId: string, total: Prisma.Decimal) {
  await enqueuePostingJobAfterCommit({
    tenantId,
    kind: 'EXPENSE_APPROVAL_JOURNAL',
    sourceType: 'ExpenseReport',
    sourceId: reportId,
    variant: 'approved',
    amount: formatMoney(total),
  })
}

async function getReport(tenantId: string, reportId: string, userId?: string) {
  const report = await ledgerDb.expenseReport.findFirst({
    where: { id: reportId, tenantId, ...(userId ? { userId } : {}) },
    include: { lines: { orderBy: { incurredAt: 'asc' } } },
  })
  if (!report) throw new ApiError(404, 'Expense report not found')
  return report
}

export async function getExpenseReport(tenantId: string, reportId: string, userId?: string) {
  return getReport(tenantId, reportId, userId)
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
          receiptUrl: l.receiptUrl ?? null,
        })),
      },
    })
    return ledgerDb.expenseReport.update({
      where: { id: reportId },
      data: { status: ExpenseReportStatus.PENDING_APPROVAL, submittedAt: now },
      include: { lines: true },
    })
  }

  const approved = await transitionReport(tenantId, reportId, ExpenseReportStatus.DRAFT, {
    status: ExpenseReportStatus.APPROVED,
    submittedAt: now,
    decidedAt: now,
  })
  await queueApprovalJournal(tenantId, reportId, report.totalAmount)
  return approved
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
    return transitionReport(tenantId, reportId, ExpenseReportStatus.PENDING_APPROVAL, {
      status: ExpenseReportStatus.REJECTED,
      decidedAt: new Date(),
      rejectReason: decision.rejectReason?.trim() || 'Rejected',
    })
  }

  const approved = await transitionReport(tenantId, reportId, ExpenseReportStatus.PENDING_APPROVAL, {
    status: ExpenseReportStatus.APPROVED,
    decidedAt: new Date(),
  })
  await queueApprovalJournal(tenantId, reportId, report.totalAmount)
  return approved
}

export async function markExpenseReportPaid(tenantId: string, reportId: string) {
  const report = await getReport(tenantId, reportId)
  if (report.status !== ExpenseReportStatus.APPROVED) {
    throw new ApiError(400, 'Only approved expense reports can be marked paid')
  }
  const paid = await transitionReport(tenantId, reportId, ExpenseReportStatus.APPROVED, { status: ExpenseReportStatus.PAID })
  // Dr Reimbursements Payable, Cr Cash. Its own source key, so it never collides with the approval journal.
  await enqueuePostingJobAfterCommit({
    tenantId,
    kind: 'EXPENSE_PAID_JOURNAL',
    sourceType: 'ExpenseReport',
    sourceId: reportId,
    variant: 'paid',
    amount: formatMoney(report.totalAmount),
  })
  return paid
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
