import { inventoryDb } from './db'
import { ApiError } from './session'

export async function buildSkuLabelHtml(tenantId: string, skuId: string, quantity = 1) {
  const sku = await inventoryDb.sKU.findFirst({ where: { id: skuId, tenantId } })
  if (!sku) throw new ApiError(404, 'SKU not found')

  const code = sku.barcode || sku.code
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Label ${sku.code}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; }
  .label { width: 4in; height: 2in; border: 1px solid #ccc; padding: 12px; box-sizing: border-box; page-break-after: always; }
  .name { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
  .code { font-size: 22px; letter-spacing: 2px; font-family: monospace; }
  .barcode { margin-top: 8px; font-size: 11px; color: #555; }
</style></head><body>
${Array.from({ length: Math.max(1, quantity) })
  .map(
    () => `<div class="label">
  <div class="name">${escapeHtml(sku.name)}</div>
  <div class="code">${escapeHtml(sku.code)}</div>
  <div class="barcode">*${escapeHtml(code)}*</div>
</div>`,
  )
  .join('\n')}
</body></html>`
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
