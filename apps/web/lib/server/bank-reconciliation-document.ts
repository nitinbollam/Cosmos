import PDFDocument from 'pdfkit'
import { UNKNOWN_USER_LABEL, type ReconciliationWorkspace } from './bank-reconciliation'
import { pdfBuffer, tenantName } from './financial-statement-document'

type ReportInput = { workspace: ReconciliationWorkspace; snapshotMismatch: boolean }
type Line = { text: string; bold?: boolean; size?: number; gapBefore?: boolean }

const BALANCE_ROWS: [keyof ReconciliationWorkspace['balances'], string][] = [
  ['bookBalance', 'Book balance'],
  ['bankBalance', 'Bank statement closing balance'],
  ['depositsInTransit', 'Deposits in transit'],
  ['outstandingPayments', 'Outstanding payments'],
  ['adjustedBank', 'Adjusted bank balance'],
  ['unrecordedBankItems', 'Bank items not in books'],
  ['adjustedBook', 'Adjusted book balance'],
  ['difference', 'Difference'],
]

/** The report as plain lines; the PDF renders exactly these, and tests read them without parsing PDF streams. */
export function reconciliationReportLines(
  input: ReportInput,
  meta: { tenantName: string; generatedAt: Date; generatedBy: string },
): Line[] {
  const { workspace: ws, snapshotMismatch } = input
  const r = ws.reconciliation
  const who = (id: string | null) => (id ? (ws.people[id] ?? UNKNOWN_USER_LABEL) : '-')
  const lines: Line[] = [
    { text: 'Bank Reconciliation', bold: true, size: 18 },
    { text: meta.tenantName },
    { text: `Bank account: ${ws.bankAccount.name}${ws.bankAccount.accountNumberMasked ? ` (${ws.bankAccount.accountNumberMasked})` : ''}` },
    { text: `Period: ${r.periodStart} to ${r.periodEnd}` },
    { text: `Status: ${r.status}` },
    { text: `Prepared by: ${who(r.preparedById)}${r.preparedAt ? ` at ${r.preparedAt}` : ''}` },
    { text: `Signed off by: ${who(r.signedOffById)}${r.signedOffAt ? ` at ${r.signedOffAt}` : ''}` },
    { text: 'Balances', bold: true, size: 12, gapBefore: true },
    ...BALANCE_ROWS.map(([key, label]) => ({ text: `${label}: ${ws.balances[key]} ${ws.bankAccount.currency}` })),
    { text: `Statement opening balance: ${r.statementOpeningBalance}` },
  ]
  if (ws.balances.statementDifference !== '0.00') {
    lines.push({ text: `Warning: statement lines do not roll forward to the closing balance (${ws.balances.statementDifference})` })
  }
  if (snapshotMismatch) {
    lines.push({ text: 'Warning: current figures differ from the values recorded at sign-off' })
  }
  lines.push({ text: `Matched (${ws.matched.length})`, bold: true, size: 12, gapBefore: true })
  for (const m of ws.matched) {
    const bank = m.statementLines.map((s) => s.amount).join(' + ')
    const book = m.journalLines.map((j) => j.amount).join(' + ')
    lines.push({ text: `${m.type} ${m.matchId}: bank ${bank} = book ${book}` })
  }
  lines.push({ text: `Unmatched book items (${ws.unmatchedBook.length})`, bold: true, size: 12, gapBefore: true })
  for (const b of ws.unmatchedBook) lines.push({ text: `${b.date}  ${b.amount}  ${b.description}` })
  lines.push({ text: `Unmatched bank items (${ws.unmatchedBank.length})`, bold: true, size: 12, gapBefore: true })
  for (const b of ws.unmatchedBank) lines.push({ text: `${b.date}  ${b.amount}  ${b.description}${b.reference ? ` [${b.reference}]` : ''}` })
  if (ws.otherPeriodMatches.length) {
    lines.push({ text: `Matched in a later period (${ws.otherPeriodMatches.length})`, bold: true, size: 12, gapBefore: true })
    for (const m of ws.otherPeriodMatches) {
      const items = [...m.statementLines.map((s) => `bank ${s.date} ${s.amount}`), ...m.journalLines.map((j) => `book ${j.date} ${j.amount}`)]
      const effect = m.clearedAsOfThisPeriod ? 'cleared as of this period' : 'outstanding at this period end'
      lines.push({ text: `${m.periodStart} to ${m.periodEnd}: ${items.join(', ')} (${effect})` })
    }
  }
  lines.push({ text: `Generated ${meta.generatedAt.toISOString()} by ${meta.generatedBy}`, size: 8, gapBefore: true })
  return lines
}

export async function buildReconciliationPdf(tenantId: string, input: ReportInput, generatedBy: string) {
  const lines = reconciliationReportLines(input, {
    tenantName: await tenantName(tenantId),
    generatedAt: new Date(),
    generatedBy,
  })
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 })
  for (const l of lines) {
    if (l.gapBefore) doc.moveDown(0.8)
    doc.font(l.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(l.size ?? 10).text(l.text)
  }
  doc.end()
  return pdfBuffer(doc)
}
