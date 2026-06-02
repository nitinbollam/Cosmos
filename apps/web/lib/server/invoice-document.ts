import * as crm from './crm'

type InvoiceDocInput = {
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

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export async function buildInvoiceHtml(tenantId: string, inv: InvoiceDocInput): Promise<string> {
  let customerName = inv.customerId
  try {
    const c = await crm.getCustomer(tenantId, inv.customerId)
    customerName = c.name
  } catch {
    /* use id */
  }

  const rows = inv.lineItems
    .map(
      (li) =>
        `<tr><td>${li.skuId.slice(0, 16)}</td><td style="text-align:right">${li.quantity}</td><td style="text-align:right">${money(li.unitPrice)}</td><td style="text-align:right">${money(li.quantity * li.unitPrice)}</td></tr>`,
    )
    .join('')

  const credits =
    inv.creditMemos && inv.creditMemos.length > 0
      ? `<h3>Credit memos</h3><ul>${inv.creditMemos.map((cm) => `<li>${cm.memoNumber} — ${money(Number(cm.totalAmount))}${cm.reason ? ` (${cm.reason})` : ''}</li>`).join('')}</ul>`
      : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${inv.invoiceNumber}</title>
  <style>
    body { font-family: system-ui, sans-serif; color: #111; max-width: 720px; margin: 40px auto; padding: 0 24px; }
    h1 { font-size: 28px; margin-bottom: 4px; }
    .meta { color: #555; font-size: 14px; margin-bottom: 32px; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    th, td { border-bottom: 1px solid #ddd; padding: 8px 4px; font-size: 14px; }
    th { text-align: left; color: #444; }
    .totals { margin-top: 24px; width: 280px; margin-left: auto; }
    .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
    .balance { font-weight: 700; font-size: 18px; color: #7161EF; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>Invoice ${inv.invoiceNumber}</h1>
  <div class="meta">
    <div>Bill to: ${customerName}</div>
    <div>Issued: ${inv.issuedAt.toLocaleDateString()}</div>
    ${inv.dueAt ? `<div>Due: ${inv.dueAt.toLocaleDateString()}</div>` : ''}
    <div>Status: ${inv.displayStatus}</div>
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
  <p style="margin-top:48px;font-size:12px;color:#888">Cosmos Distribution ERP — print or Save as PDF from your browser.</p>
</body>
</html>`
}
