import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { applyProduct, type QuoteLineDraft } from '@/lib/quote-lines'

type SkuOption = { id: string; code: string; name: string; price: string | number }

/**
 * The buyer's quote lines: a product search per line (picking one fills its SKU, name and price), description,
 * quantity and unit price, plus add / remove. Shared by "New quote" and "Edit quote" so both behave the same.
 */
export function QuoteLinesEditor({
  lines,
  onChange,
  disabled = false,
  listId = 'quote-sku-options',
}: {
  lines: QuoteLineDraft[]
  onChange: (lines: QuoteLineDraft[]) => void
  disabled?: boolean
  /** The datalist id; must be unique on the page. */
  listId?: string
}) {
  // Product search for the line being edited; picking one fills its SKU, name and price.
  const [searchTerm, setSearchTerm] = useState('')
  const [options, setOptions] = useState<SkuOption[]>([])

  useEffect(() => {
    const term = searchTerm.trim()
    if (term.length < 2) {
      setOptions([])
      return
    }
    const t = setTimeout(() => {
      void api
        .get<{ items?: SkuOption[] }>(`/skus?search=${encodeURIComponent(term)}&pageSize=20`)
        .then((res) => setOptions(res.items ?? []))
        .catch(() => setOptions([])) // swallow-ok: search suggestions only; a typed SKU is still checked on save
    }, 250)
    return () => clearTimeout(t)
  }, [searchTerm])

  const setSku = (idx: number, value: string) => {
    const next = [...lines]
    const match = options.find((o) => o.code === value.trim())
    next[idx] = match ? applyProduct(lines[idx], match) : { ...lines[idx], skuCode: value }
    onChange(next)
    setSearchTerm(value)
  }

  const setField = (idx: number, patch: Partial<QuoteLineDraft>) => {
    const next = [...lines]
    next[idx] = { ...lines[idx], ...patch }
    onChange(next)
  }

  return (
    <>
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.id} value={o.code}>
            {o.name}
          </option>
        ))}
      </datalist>
      {lines.map((l, idx) => (
        <div key={l.lineNo} className="pleros-shop-line-card">
          <span className="pleros-shop-muted" style={{ fontSize: 12 }}>
            Line #{l.lineNo}
            <button
              type="button"
              aria-label={`Remove line ${l.lineNo}`}
              style={{ marginLeft: 12, color: 'var(--c-danger)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}
              onClick={() => onChange(lines.filter((_, i) => i !== idx).map((x, i) => ({ ...x, lineNo: i + 1 })))}
              disabled={disabled || lines.length <= 1}
            >
              Remove
            </button>
          </span>
          <input
            placeholder="Product: search by name or SKU (required)"
            aria-label={`Line ${l.lineNo} product`}
            required
            list={listId}
            className="pleros-shop-field pleros-shop-field--mono"
            style={{ marginTop: 0, padding: 8 }}
            value={l.skuCode}
            disabled={disabled}
            onFocus={() => setSearchTerm(l.skuCode)}
            onChange={(e) => setSku(idx, e.target.value)}
          />
          <input
            placeholder="Description"
            aria-label={`Line ${l.lineNo} description`}
            className="pleros-shop-field"
            style={{ marginTop: 0, padding: 8 }}
            value={l.description}
            disabled={disabled}
            onChange={(e) => setField(idx, { description: e.target.value })}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
              min={1}
              placeholder="Qty"
              aria-label={`Line ${l.lineNo} quantity`}
              className="pleros-shop-field"
              style={{ flex: 1, marginTop: 0, padding: 8 }}
              value={l.qty}
              disabled={disabled}
              onChange={(e) => setField(idx, { qty: e.target.value })}
            />
            <input
              type="number"
              step="0.01"
              placeholder="Unit price"
              aria-label={`Line ${l.lineNo} unit price`}
              className="pleros-shop-field"
              style={{ flex: 1, marginTop: 0, padding: 8 }}
              value={l.unitPrice}
              disabled={disabled}
              onChange={(e) => setField(idx, { unitPrice: e.target.value })}
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="pleros-shop-btn-dashed"
        disabled={disabled}
        onClick={() => onChange([...lines, { lineNo: lines.length + 1, skuCode: '', description: '', qty: '1', unitPrice: '0' }])}
      >
        + Line
      </button>
    </>
  )
}
