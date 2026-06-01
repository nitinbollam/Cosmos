import { orderDb, tenantDb } from './db'
import { ApiError } from './session'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export async function buildPosReceiptHtml(tenantId: string, orderId: string) {
  const [org, order] = await Promise.all([
    tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } }),
    orderDb.order.findFirst({
      where: { id: orderId, tenantId },
      include: { lineItems: true },
    }),
  ])
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.channel !== 'POS') throw new ApiError(400, 'Receipt is only available for POS orders')

  const subtotal = order.lineItems.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0)
  const tax = Number(order.taxAmount ?? 0)
  const total = Number(order.totalAmount ?? subtotal + tax)
  const paid = Number(order.amountPaid ?? 0)

  const lines = order.lineItems
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.skuId.slice(-8))}</td><td class="qty">${l.quantity}</td><td class="amt">${money(Number(l.unitPrice))}</td><td class="amt">${money(Number(l.quantity) * Number(l.unitPrice))}</td></tr>`,
    )
    .join('\n')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt ${order.id.slice(-8)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; max-width: 320px; color: #111; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #555; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 4px 0; text-align: left; border-bottom: 1px dashed #ddd; }
  th { font-size: 10px; text-transform: uppercase; color: #666; }
  .qty { width: 32px; text-align: center; }
  .amt { text-align: right; white-space: nowrap; }
  .totals { margin-top: 12px; font-size: 12px; }
  .totals div { display: flex; justify-content: space-between; margin: 4px 0; }
  .total { font-weight: 700; font-size: 14px; border-top: 1px solid #111; padding-top: 8px; margin-top: 8px; }
  @media print { body { margin: 8px; } }
</style></head><body>
  <h1>${escapeHtml(org?.displayName ?? 'Cosmos POS')}</h1>
  <div class="meta">
    Receipt #${escapeHtml(order.id.slice(-8).toUpperCase())}<br>
    ${new Date(order.createdAt).toLocaleString()}<br>
    Payment: ${escapeHtml(order.paymentMethod ?? '—')}
  </div>
  <table>
    <thead><tr><th>Item</th><th class="qty">Qty</th><th class="amt">Price</th><th class="amt">Total</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${money(subtotal)}</span></div>
    <div><span>Tax</span><span>${money(tax)}</span></div>
    <div class="total"><span>Total</span><span>${money(total)}</span></div>
    ${paid > 0 ? `<div><span>Paid</span><span>${money(paid)}</span></div>` : ''}
  </div>
  <p class="meta" style="margin-top:20px">Thank you for your purchase.</p>
</body></html>`
}
