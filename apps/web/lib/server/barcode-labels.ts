import bwipjs from 'bwip-js/node'
import { inventoryDb } from './db'
import { ApiError } from './session'

/** Standard thermal / sheet label sizes (width × height inches). */
export const LABEL_SIZES = {
  '4x2': { id: '4x2', widthIn: 4, heightIn: 2, label: '4×2 in' },
  '4x1': { id: '4x1', widthIn: 4, heightIn: 1, label: '4×1 in' },
  '3x2': { id: '3x2', widthIn: 3, heightIn: 2, label: '3×2 in' },
  '2x1': { id: '2x1', widthIn: 2, heightIn: 1, label: '2×1 in' },
} as const

export type LabelSizeId = keyof typeof LABEL_SIZES
export type LabelSymbols = 'both' | 'code128' | 'qr'

export type LabelPrintOptions = {
  quantity?: number
  size?: string
  symbols?: string
}

export type SkuLabelData = {
  name: string
  code: string
  barcode?: string | null
}

const MAX_QTY = 99
const DEFAULT_SIZE: LabelSizeId = '4x2'
const DEFAULT_SYMBOLS: LabelSymbols = 'both'

export function resolveLabelSize(raw?: string): LabelSizeId {
  const key = (raw ?? DEFAULT_SIZE).trim().toLowerCase()
  return key in LABEL_SIZES ? (key as LabelSizeId) : DEFAULT_SIZE
}

export function resolveLabelSymbols(raw?: string): LabelSymbols {
  const key = (raw ?? DEFAULT_SYMBOLS).trim().toLowerCase()
  if (key === 'code128' || key === 'barcode') return 'code128'
  if (key === 'qr' || key === 'qrcode') return 'qr'
  return 'both'
}

export function clampLabelQuantity(raw?: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1
  return Math.min(MAX_QTY, Math.max(1, Math.round(n)))
}

/** Value encoded in Code128 / QR — barcode when set, else SKU code. */
export function scanValueForSku(sku: SkuLabelData): string {
  const barcode = sku.barcode?.trim()
  if (barcode) return barcode
  return sku.code.trim()
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function stripSvgXmlDecl(svg: string): string {
  return svg.replace(/<\?xml[^?]+\?>\s*/i, '').trim()
}

/** Code128 tuned for handheld / camera scan at ~4–6 in. */
export function renderCode128Svg(text: string): string {
  const svg = bwipjs.toSVG({
    bcid: 'code128',
    text,
    scale: 3,
    height: 14,
    includetext: false,
    paddingwidth: 12,
    paddingheight: 2,
    backgroundcolor: 'FFFFFF',
  })
  return stripSvgXmlDecl(svg)
}

/** QR with medium EC — readable at arm’s length on phone cameras. */
export function renderQrSvg(text: string): string {
  // eclevel is a valid BWIPP option; types omit barcode-specific keys
  const svg = bwipjs.toSVG({
    bcid: 'qrcode',
    text,
    scale: 4,
    eclevel: 'M',
    paddingwidth: 4,
    paddingheight: 4,
    backgroundcolor: 'FFFFFF',
  } as Parameters<typeof bwipjs.toSVG>[0])
  return stripSvgXmlDecl(svg)
}

function sizeCss(size: LabelSizeId) {
  const { widthIn, heightIn } = LABEL_SIZES[size]
  const compact = heightIn <= 1
  const qrIn = compact ? 0.55 : heightIn >= 2 ? 0.95 : 0.7
  const codeH = compact ? 0.38 : 0.55
  return {
    widthIn,
    heightIn,
    compact,
    qrIn,
    codeH,
  }
}

export function buildLabelDocumentHtml(
  sku: SkuLabelData,
  opts: { quantity?: number; size?: string; symbols?: string } = {},
): string {
  const quantity = clampLabelQuantity(opts.quantity)
  const sizeId = resolveLabelSize(opts.size)
  const symbols = resolveLabelSymbols(opts.symbols)
  const scan = scanValueForSku(sku)
  if (!scan) throw new ApiError(400, 'SKU has no code or barcode to encode')

  const dims = sizeCss(sizeId)
  const showCode128 = symbols === 'both' || symbols === 'code128'
  const showQr = symbols === 'both' || symbols === 'qr'

  let code128Svg = ''
  let qrSvg = ''
  try {
    if (showCode128) code128Svg = renderCode128Svg(scan)
    if (showQr) qrSvg = renderQrSvg(scan)
  } catch {
    throw new ApiError(400, 'Unable to encode barcode for this SKU value')
  }

  const layout = dims.compact ? 'compact' : 'standard'
  const name = escapeHtml(sku.name)
  const code = escapeHtml(sku.code)
  const hri = escapeHtml(scan)

  const labels = Array.from({ length: quantity }, () => {
    const qrBlock = showQr
      ? `<div class="qr" aria-hidden="true">${qrSvg}</div>`
      : ''
    const code128Block = showCode128
      ? `<div class="code128" aria-hidden="true">${code128Svg}</div>`
      : ''

    return `<div class="label layout-${layout}${showQr ? ' has-qr' : ''}${showCode128 ? ' has-code128' : ''}">
  <div class="meta">
    <div class="name">${name}</div>
    <div class="sku">${code}</div>
    ${code128Block}
    <div class="hri">${hri}</div>
  </div>
  ${qrBlock}
</div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Label ${code}</title>
<style>
  @page {
    size: ${dims.widthIn}in ${dims.heightIn}in;
    margin: 0;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
    font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .label {
    width: ${dims.widthIn}in;
    height: ${dims.heightIn}in;
    padding: ${dims.compact ? '0.08in 0.1in' : '0.12in 0.14in'};
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: ${dims.compact ? '0.08in' : '0.12in'};
    page-break-after: always;
    break-after: page;
    overflow: hidden;
    background: #fff;
    border: 1px solid #ddd;
  }
  .label:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  .meta {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .name {
    font-size: ${dims.compact ? '9pt' : '11pt'};
    font-weight: 600;
    line-height: 1.15;
    max-height: ${dims.compact ? '1.3em' : '2.3em'};
    overflow: hidden;
  }
  .sku {
    font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
    font-size: ${dims.compact ? '10pt' : '13pt'};
    letter-spacing: 0.04em;
    margin: 0.04in 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .code128 {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    min-height: ${dims.codeH}in;
  }
  .code128 svg {
    display: block;
    width: 100%;
    height: ${dims.codeH}in;
  }
  .hri {
    font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
    font-size: ${dims.compact ? '8pt' : '9pt'};
    letter-spacing: 0.06em;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .qr {
    flex: 0 0 ${dims.qrIn}in;
    width: ${dims.qrIn}in;
    height: ${dims.qrIn}in;
    align-self: center;
  }
  .qr svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .label:not(.has-code128) .meta {
    justify-content: center;
    gap: 0.06in;
  }
  @media print {
    .label { border: none; }
  }
</style>
</head>
<body>
${labels}
</body>
</html>`
}

export async function buildSkuLabelHtml(
  tenantId: string,
  skuId: string,
  quantityOrOpts: number | LabelPrintOptions = 1,
) {
  const opts: LabelPrintOptions =
    typeof quantityOrOpts === 'number' ? { quantity: quantityOrOpts } : quantityOrOpts

  const sku = await inventoryDb.sKU.findFirst({ where: { id: skuId, tenantId } })
  if (!sku) throw new ApiError(404, 'SKU not found')

  return buildLabelDocumentHtml(
    { name: sku.name, code: sku.code, barcode: sku.barcode },
    opts,
  )
}
