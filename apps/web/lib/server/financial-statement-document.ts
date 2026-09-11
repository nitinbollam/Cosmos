import PDFDocument from 'pdfkit'
import type { IncomeStatementResult } from './financial-statements'
import * as tenant from './tenant'

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

async function tenantName(tenantId: string): Promise<string> {
  try {
    const org = await tenant.findTenantById(tenantId)
    if (org.displayName?.trim()) return org.displayName.trim()
  } catch {
    /* default */
  }
  return 'Pleros Distribution ERP'
}

function pdfBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

export async function buildIncomeStatementPdf(
  tenantId: string,
  statement: IncomeStatementResult,
): Promise<Buffer> {
  const displayName = await tenantName(tenantId)
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 })
  const left = doc.page.margins.left
  const right = doc.page.width - doc.page.margins.right
  const width = right - left

  doc.fontSize(20).font('Helvetica-Bold').text('Income Statement', left)
  doc.fontSize(10).font('Helvetica').fillColor('#444444')
  doc.text(`${displayName}`, left)
  doc.text(`Period: ${statement.fromIso} to ${statement.toIso}`, left)
  doc.moveDown(1.5)

  doc.fillColor('#000000').font('Helvetica-Bold').fontSize(12).text('Revenue', left)
  doc.font('Helvetica').fontSize(10)
  for (const row of statement.revenue.byAccount) {
    doc.text(`${row.code} · ${row.name}`, left, doc.y, { width: width * 0.7, continued: true })
    doc.text(money(row.amount), { align: 'right', width })
  }
  doc.font('Helvetica-Bold').text('Total revenue', left, doc.y + 4, { width: width * 0.7, continued: true })
  doc.text(money(statement.revenue.total), { align: 'right', width })
  doc.moveDown(1)

  doc.font('Helvetica-Bold').fontSize(12).text('Expenses', left)
  doc.font('Helvetica').fontSize(10)
  for (const row of statement.expenses.byAccount) {
    doc.text(`${row.code} · ${row.name}`, left, doc.y, { width: width * 0.7, continued: true })
    doc.text(money(row.amount), { align: 'right', width })
  }
  doc.font('Helvetica-Bold').text('Total expenses', left, doc.y + 4, { width: width * 0.7, continued: true })
  doc.text(money(statement.expenses.total), { align: 'right', width })
  doc.moveDown(1.5)

  doc.font('Helvetica-Bold').fontSize(12).text('Net income', left, doc.y, { width: width * 0.7, continued: true })
  doc.text(money(statement.netIncome), { align: 'right', width })

  doc.end()
  return pdfBuffer(doc)
}
