import PDFDocument from 'pdfkit'
import * as crm from './crm'
import * as tenant from './tenant'

export type InvoiceDocInput = {
  invoiceNumber: string
  issuedAt: Date
  dueAt?: Date | null
  customerId: string
  subtotal: number
  taxAmount: number
  totalAmount: number
  amountPaid: number
  balance: number
  displayStatus: string
  lineItems: Array<{ skuId: string; quantity: number; unitPrice: number }>
  creditMemos?: Array<{ memoNumber: string; totalAmount: number; reason?: string | null }>
}

export type InvoiceDocContext = {
  customerName: string
  tenantDisplayName: string
}

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

/** Escape user-controlled values (customer names, memo reasons) before HTML interpolation. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export async function resolveInvoiceDocContext(tenantId: string, inv: InvoiceDocInput): Promise<InvoiceDocContext> {
  let customerName = inv.customerId
  try {
    const c = await crm.getCustomer(tenantId, inv.customerId)
    customerName = c.name
  } catch {
    /* use id */
  }

  let tenantDisplayName = 'Pleros Distribution ERP'
  try {
    const org = await tenant.findTenantById(tenantId)
    if (org.displayName?.trim()) tenantDisplayName = org.displayName.trim()
  } catch {
    /* default */
  }

  return { customerName, tenantDisplayName }
}

export async function buildInvoiceHtml(tenantId: string, inv: InvoiceDocInput): Promise<string> {
  const { customerName, tenantDisplayName } = await resolveInvoiceDocContext(tenantId, inv)

  const rows = inv.lineItems
    .map(
      (li) =>
        `<tr><td>${esc(li.skuId.slice(0, 16))}</td><td style="text-align:right">${li.quantity}</td><td style="text-align:right">${money(li.unitPrice)}</td><td style="text-align:right">${money(li.quantity * li.unitPrice)}</td></tr>`,
    )
    .join('')

  const credits =
    inv.creditMemos && inv.creditMemos.length > 0
      ? `<h3>Credit memos</h3><ul>${inv.creditMemos.map((cm) => `<li>${esc(cm.memoNumber)} — ${money(Number(cm.totalAmount))}${cm.reason ? ` (${esc(cm.reason)})` : ''}</li>`).join('')}</ul>`
      : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${esc(inv.invoiceNumber)}</title>
  <style>
    body { font-family: system-ui, sans-serif; color: #111; max-width: 720px; margin: 40px auto; padding: 0 24px; }
    h1 { font-size: 28px; margin-bottom: 4px; }
    .meta { color: #555; font-size: 14px; margin-bottom: 32px; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    th, td { border-bottom: 1px solid #ddd; padding: 8px 4px; font-size: 14px; }
    th { text-align: left; color: #444; }
    .totals { margin-top: 24px; width: 280px; margin-left: auto; }
    .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
    .balance { font-weight: 700; font-size: 18px; color: #5B8DEF; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>Invoice ${esc(inv.invoiceNumber)}</h1>
  <div class="meta">
    <div>Bill to: ${esc(customerName)}</div>
    <div>Issued: ${inv.issuedAt.toLocaleDateString()}</div>
    ${inv.dueAt ? `<div>Due: ${inv.dueAt.toLocaleDateString()}</div>` : ''}
    <div>Status: ${esc(inv.displayStatus)}</div>
  </div>
  <table>
    <thead><tr><th>SKU</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Line</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${money(inv.subtotal)}</span></div>
    <div><span>Tax</span><span>${money(inv.taxAmount)}</span></div>
    <div><span>Total</span><span>${money(inv.totalAmount)}</span></div>
    <div><span>Paid</span><span>${money(inv.amountPaid)}</span></div>
    <div class="balance"><span>Balance due</span><span>${money(inv.balance)}</span></div>
  </div>
  ${credits}
  <p style="margin-top:48px;font-size:12px;color:#888">${esc(tenantDisplayName)}</p>
</body>
</html>`
}

function pdfEnsureSpace(doc: InstanceType<typeof PDFDocument>, y: number, needed: number): number {
  const bottom = doc.page.height - doc.page.margins.bottom
  if (y + needed > bottom) {
    doc.addPage()
    return doc.page.margins.top
  }
  return y
}

export async function buildInvoicePdf(tenantId: string, inv: InvoiceDocInput): Promise<Buffer> {
  const { customerName, tenantDisplayName } = await resolveInvoiceDocContext(tenantId, inv)

  const doc = new PDFDocument({ size: 'LETTER', margin: 50 })
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))

  const left = doc.page.margins.left
  const right = doc.page.width - doc.page.margins.right
  const tableWidth = right - left
  const colSku = left
  const colQty = left + tableWidth * 0.55
  const colUnit = left + tableWidth * 0.68
  const colLine = left + tableWidth * 0.82
  const totalsX = left + tableWidth * 0.55
  const totalsValX = right - 80

  let y = doc.y

  doc.fontSize(22).font('Helvetica-Bold').text(`Invoice ${inv.invoiceNumber}`, left, y)
  y = doc.y + 8

  doc.fontSize(10).font('Helvetica').fillColor('#444444')
  doc.text(`Bill to: ${customerName}`, left, y)
  y = doc.y + 2
  doc.text(`Issued: ${inv.issuedAt.toLocaleDateString()}`, left, y)
  y = doc.y + 2
  if (inv.dueAt) {
    doc.text(`Due: ${inv.dueAt.toLocaleDateString()}`, left, y)
    y = doc.y + 2
  }
  doc.text(`Status: ${inv.displayStatus}`, left, y)
  y = doc.y + 20

  doc.fillColor('#000000')
  doc.font('Helvetica-Bold').fontSize(10)
  y = pdfEnsureSpace(doc, y, 24)
  doc.text('SKU', colSku, y)
  doc.text('Qty', colQty, y, { width: 40, align: 'right' })
  doc.text('Unit', colUnit, y, { width: 60, align: 'right' })
  doc.text('Line', colLine, y, { width: 70, align: 'right' })
  y += 14

  doc.moveTo(left, y).lineTo(right, y).strokeColor('#cccccc').stroke()
  y += 8

  doc.font('Helvetica').fontSize(10)
  for (const li of inv.lineItems) {
    y = pdfEnsureSpace(doc, y, 16)
    const sku = li.skuId.slice(0, 16)
    doc.text(sku, colSku, y, { width: colQty - colSku - 8 })
    doc.text(String(li.quantity), colQty, y, { width: 40, align: 'right' })
    doc.text(money(li.unitPrice), colUnit, y, { width: 60, align: 'right' })
    doc.text(money(li.quantity * li.unitPrice), colLine, y, { width: 70, align: 'right' })
    y += 14
  }

  y = pdfEnsureSpace(doc, y, 100)
  y += 12
  doc.moveTo(totalsX - 10, y).lineTo(right, y).strokeColor('#cccccc').stroke()
  y += 12

  const totalRows: Array<[string, string, boolean?]> = [
    ['Subtotal', money(inv.subtotal)],
    ['Tax', money(inv.taxAmount)],
    ['Total', money(inv.totalAmount)],
    ['Paid', money(inv.amountPaid)],
    ['Balance due', money(inv.balance), true],
  ]

  for (const [label, value, bold] of totalRows) {
    y = pdfEnsureSpace(doc, y, 16)
    if (bold) doc.font('Helvetica-Bold')
    else doc.font('Helvetica')
    doc.text(label, totalsX, y)
    doc.text(value, totalsValX, y, { width: 80, align: 'right' })
    y += 14
  }

  if (inv.creditMemos && inv.creditMemos.length > 0) {
    y = pdfEnsureSpace(doc, y, 40)
    y += 8
    doc.font('Helvetica-Bold').fontSize(11).text('Credit memos', left, y)
    y = doc.y + 6
    doc.font('Helvetica').fontSize(10)
    for (const cm of inv.creditMemos) {
      y = pdfEnsureSpace(doc, y, 14)
      const line = `${cm.memoNumber} — ${money(Number(cm.totalAmount))}${cm.reason ? ` (${cm.reason})` : ''}`
      doc.text(line, left, y, { width: tableWidth })
      y = doc.y + 4
    }
  }

  y = pdfEnsureSpace(doc, y, 30)
  doc.fontSize(9).fillColor('#888888').font('Helvetica').text(tenantDisplayName, left, y + 20, {
    width: tableWidth,
    align: 'center',
  })

  doc.end()

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}
