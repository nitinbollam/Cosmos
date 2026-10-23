import PDFDocument from 'pdfkit'
import { pdfBuffer, tenantName } from './financial-statement-document'
import * as inv from './inventory'
import { formatMoney } from './money'

/** More rows than this would make an unreadable document; the PDF says when it was cut short. */
export const INVENTORY_PDF_MAX_ROWS = 5000

export type InventoryPdfFilters = {
  search?: string
  category?: string
  warehouseId?: string
  inStockOnly?: boolean
}

type Column = { label: string; width: number; align?: 'left' | 'right' }

// Landscape letter leaves 712pt between 40pt margins.
const COLUMNS: Column[] = [
  { label: 'SKU code', width: 90 },
  { label: 'Name', width: 190 },
  { label: 'Category', width: 100 },
  { label: 'On hand', width: 52, align: 'right' },
  { label: 'Reserved', width: 52, align: 'right' },
  { label: 'Available', width: 56, align: 'right' },
  { label: 'Reorder', width: 48, align: 'right' },
  { label: 'Cost', width: 62, align: 'right' },
  { label: 'Price', width: 62, align: 'right' },
]

/** Builds the inventory list as a PDF, with the same filters and columns as Admin → Inventory. */
export async function buildInventoryListPdf(tenantId: string, filters: InventoryPdfFilters): Promise<Buffer> {
  const [displayName, list, warehouse] = await Promise.all([
    tenantName(tenantId),
    inv.listSkus(tenantId, 1, INVENTORY_PDF_MAX_ROWS, filters.search, {
      category: filters.category,
      warehouseId: filters.warehouseId,
      inStockOnly: filters.inStockOnly,
    }),
    filters.warehouseId ? inv.findWarehouseById(tenantId, filters.warehouseId) : Promise.resolve(null),
  ])

  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40 })
  const left = doc.page.margins.left
  const bottom = () => doc.page.height - doc.page.margins.bottom

  doc.fontSize(18).font('Helvetica-Bold').fillColor('#000000').text('Inventory', left)
  doc.fontSize(9).font('Helvetica').fillColor('#444444')
  doc.text(`${displayName} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, left)
  const applied = [
    filters.search && `search "${filters.search}"`,
    filters.category && `category ${filters.category}`,
    warehouse && `warehouse ${warehouse.code} · ${warehouse.name}`,
    filters.inStockOnly && 'in stock only',
  ].filter(Boolean)
  doc.text(applied.length ? `Filters: ${applied.join(', ')}` : 'Filters: none (all SKUs)', left)
  const shown = list.items.length
  doc.text(
    shown < list.total ? `Showing the first ${shown} of ${list.total} SKUs` : `${list.total} SKU${list.total === 1 ? '' : 's'}`,
    left,
  )
  doc.moveDown(0.8)

  const row = (cells: string[], bold = false) => {
    const y = doc.y
    let x = left
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#000000')
    const heights = cells.map((cell, i) => doc.heightOfString(cell, { width: COLUMNS[i].width - 6 }))
    const h = Math.max(...heights) + 4
    if (y + h > bottom()) {
      doc.addPage()
      return false
    }
    cells.forEach((cell, i) => {
      doc.text(cell, x, y + 2, { width: COLUMNS[i].width - 6, align: COLUMNS[i].align ?? 'left' })
      x += COLUMNS[i].width
    })
    doc.y = y + h
    doc.moveTo(left, doc.y).lineTo(x, doc.y).lineWidth(0.3).strokeColor('#cccccc').stroke()
    return true
  }
  const header = () => row(COLUMNS.map((c) => c.label), true)

  header()
  if (!shown) {
    doc.moveDown(0.5).font('Helvetica').fontSize(9).text('No SKUs match these filters.', left)
  }
  for (const s of list.items) {
    const cells = [
      s.code,
      s.name,
      s.category,
      String(s.quantityOnHand ?? 0),
      String(s.quantityReserved ?? 0),
      String(s.quantityAvailable ?? 0),
      String(s.reorderPoint ?? 0),
      `$${formatMoney(String(s.cost ?? 0))}`,
      `$${formatMoney(String(s.price ?? 0))}`,
    ]
    // On a page break, repeat the header on the new page and then place the row.
    if (!row(cells)) {
      header()
      row(cells)
    }
  }

  doc.end()
  return pdfBuffer(doc)
}
