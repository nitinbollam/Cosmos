import { useId, useMemo, useState } from 'react'
import { formatAmount, lineAmount, parseAmountInput, sumAmounts } from '@/lib/decimal-amount'
import { submissionProblems, type Requisition } from '@/lib/requisitions'

export type RequisitionPayload = {
  supplierId: string | null
  currency: string
  freightAmount: string
  dutyAmount: string
  otherLandedAmount: string
  notes: string | null
  lines: Array<{ skuCode: string | null; description: string; qtyRequested: number; unitCost: string | null }>
}

type LineDraft = { key: string; skuCode: string; description: string; qty: string; unitCost: string }

export type LinePrefill = { skuCode: string; description: string; qtyRequested: number }

let keySeq = 0
const nextKey = () => `l${++keySeq}`
const emptyLine = (): LineDraft => ({ key: nextKey(), skuCode: '', description: '', qty: '1', unitCost: '' })
const MAX_QTY = 1_000_000

/**
 * Create / edit form for a requisition. Amounts stay strings end to end and are validated with the server's rules;
 * totals are exact (see decimal-amount.ts). A draft may leave supplier and costs empty; the panel below the totals
 * lists what still blocks submitting.
 */
export function RequisitionForm(props: {
  initial?: Requisition
  prefillLine?: LinePrefill | null
  prefillNotes?: string
  suppliers: Array<{ id: string; name: string; code: string }>
  suppliersLoading?: boolean
  saving: boolean
  serverError?: string | null
  saveLabel: string
  onSave: (payload: RequisitionPayload) => void
  onCancel?: () => void
}) {
  const ids = useId()
  const init = props.initial
  const [supplierId, setSupplierId] = useState(init?.supplierId ?? '')
  const [currency, setCurrency] = useState(init?.currency ?? 'USD')
  const [freight, setFreight] = useState(init ? String(init.freightAmount) : '0')
  const [duty, setDuty] = useState(init ? String(init.dutyAmount) : '0')
  const [other, setOther] = useState(init ? String(init.otherLandedAmount) : '0')
  const [notes, setNotes] = useState(init?.notes ?? props.prefillNotes ?? '')
  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (init?.lines.length) {
      return init.lines.map((l) => ({
        key: nextKey(),
        skuCode: l.skuCode ?? '',
        description: l.description,
        qty: String(l.qtyRequested),
        unitCost: l.unitCost == null ? '' : String(l.unitCost),
      }))
    }
    if (props.prefillLine) {
      return [{ key: nextKey(), skuCode: props.prefillLine.skuCode, description: props.prefillLine.description, qty: String(props.prefillLine.qtyRequested), unitCost: '' }]
    }
    return [emptyLine()]
  })
  const [touched, setTouched] = useState(false)

  const check = useMemo(() => {
    const errors: Record<string, string> = {}
    const amount = (key: string, raw: string, label: string) => {
      const r = parseAmountInput(raw, label)
      if (!r.ok) errors[key] = r.error
      return r.ok ? r.value : null
    }
    const cur = currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(cur)) errors.currency = 'Use a 3-letter currency code such as USD'
    const f = amount('freight', freight, 'Freight')
    const d = amount('duty', duty, 'Duty')
    const o = amount('other', other, 'Other landed cost')
    const parsedLines = lines.map((l, i) => {
      const n = i + 1
      if (!l.description.trim()) errors[`${l.key}.description`] = `Line ${n}: description is required`
      const qty = /^\d+$/.test(l.qty.trim()) ? Number(l.qty.trim()) : NaN
      if (!Number.isInteger(qty) || qty < 0 || qty > MAX_QTY) errors[`${l.key}.qty`] = `Line ${n}: quantity must be a whole number from 0 to ${MAX_QTY.toLocaleString()}`
      const cost = l.unitCost.trim() === '' ? null : amount(`${l.key}.unitCost`, l.unitCost, `Line ${n}: unit cost`)
      return { lineNo: n, skuCode: l.skuCode.trim() || null, description: l.description.trim(), qtyRequested: Number.isInteger(qty) ? qty : 0, unitCost: cost }
    })
    const lineTotal = sumAmounts(parsedLines.map((l) => (l.unitCost == null ? '0' : lineAmount(l.unitCost, l.qtyRequested))))
    const landed = sumAmounts([f ?? '0', d ?? '0', o ?? '0'])
    const payload: RequisitionPayload = {
      supplierId: supplierId || null,
      currency: cur,
      freightAmount: f ?? '0',
      dutyAmount: d ?? '0',
      otherLandedAmount: o ?? '0',
      notes: notes.trim() || null,
      lines: parsedLines.map(({ lineNo: _n, ...rest }) => rest),
    }
    return {
      errors,
      payload,
      lineTotal,
      landed,
      total: sumAmounts([lineTotal, landed]),
      blockers: submissionProblems({ supplierId: payload.supplierId, lines: parsedLines }),
    }
  }, [currency, freight, duty, other, lines, supplierId, notes])

  const errorList = Object.values(check.errors)
  const showErrors = touched && errorList.length > 0
  const err = (key: string) => (touched ? check.errors[key] : undefined)
  const fieldId = (key: string) => `${ids}-${key}`
  const describe = (key: string) => (err(key) ? `${fieldId(key)}-err` : undefined)
  const input = 'pleros-input w-full'
  const updateLine = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (errorList.length === 0 && !props.saving) props.onSave(check.payload)
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={fieldId('supplier')} className="block text-xs text-pleros-muted">
            Supplier
          </label>
          <select id={fieldId('supplier')} className={`${input} mt-1`} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{props.suppliersLoading ? 'Loading suppliers…' : 'Choose later (needed to submit)'}</option>
            {props.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={fieldId('currency')} className="block text-xs text-pleros-muted">
            Currency
          </label>
          <input
            id={fieldId('currency')}
            className={`${input} mt-1 uppercase`}
            value={currency}
            maxLength={3}
            autoComplete="off"
            aria-invalid={!!err('currency')}
            aria-describedby={describe('currency')}
            onChange={(e) => setCurrency(e.target.value)}
          />
          {err('currency') && <p id={`${fieldId('currency')}-err`} className="text-xs text-red-400 mt-1">{err('currency')}</p>}
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-pleros-white">Lines</legend>
        <p className="text-xs text-pleros-muted mt-1">Unit costs are estimates for approval. Leave one empty while drafting; 0 is allowed for free items.</p>
        <div className="mt-3 space-y-3">
          {lines.map((l, i) => {
            const n = i + 1
            const cost = parseAmountInput(l.unitCost)
            const qtyOk = /^\d+$/.test(l.qty.trim())
            return (
              <div key={l.key} className="grid grid-cols-2 sm:grid-cols-12 gap-2 rounded-md border border-pleros-border p-3">
                <div className="col-span-2 sm:col-span-5">
                  <label htmlFor={fieldId(`${l.key}.description`)} className="block text-xs text-pleros-muted">
                    Line {n} description
                  </label>
                  <input
                    id={fieldId(`${l.key}.description`)}
                    className={`${input} mt-1`}
                    value={l.description}
                    aria-invalid={!!err(`${l.key}.description`)}
                    aria-describedby={describe(`${l.key}.description`)}
                    onChange={(e) => updateLine(l.key, { description: e.target.value })}
                  />
                </div>
                <div className="col-span-2 sm:col-span-2">
                  <label htmlFor={fieldId(`${l.key}.sku`)} className="block text-xs text-pleros-muted">
                    SKU (optional)
                  </label>
                  <input id={fieldId(`${l.key}.sku`)} className={`${input} mt-1 font-mono`} value={l.skuCode} onChange={(e) => updateLine(l.key, { skuCode: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={fieldId(`${l.key}.qty`)} className="block text-xs text-pleros-muted">
                    Quantity
                  </label>
                  <input
                    id={fieldId(`${l.key}.qty`)}
                    className={`${input} mt-1`}
                    inputMode="numeric"
                    value={l.qty}
                    aria-invalid={!!err(`${l.key}.qty`)}
                    aria-describedby={describe(`${l.key}.qty`)}
                    onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={fieldId(`${l.key}.unitCost`)} className="block text-xs text-pleros-muted">
                    Unit cost ({check.payload.currency || 'USD'})
                  </label>
                  <input
                    id={fieldId(`${l.key}.unitCost`)}
                    className={`${input} mt-1`}
                    inputMode="decimal"
                    placeholder="e.g. 4.25"
                    value={l.unitCost}
                    aria-invalid={!!err(`${l.key}.unitCost`)}
                    aria-describedby={describe(`${l.key}.unitCost`)}
                    onChange={(e) => updateLine(l.key, { unitCost: e.target.value })}
                  />
                </div>
                <div className="col-span-2 sm:col-span-1 flex sm:flex-col items-center sm:items-end justify-between gap-1 sm:pt-5">
                  <span className="text-xs text-pleros-text" aria-label={`Line ${n} total`}>
                    {cost.ok && qtyOk ? formatAmount(lineAmount(cost.value, Number(l.qty.trim())), check.payload.currency) : '—'}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-pleros-muted hover:text-red-400 disabled:opacity-40"
                    aria-label={`Remove line ${n}`}
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    Remove
                  </button>
                </div>
                {(['description', 'qty', 'unitCost'] as const).map((k) =>
                  err(`${l.key}.${k}`) ? (
                    <p key={k} id={`${fieldId(`${l.key}.${k}`)}-err`} className="col-span-2 sm:col-span-12 text-xs text-red-400">
                      {err(`${l.key}.${k}`)}
                    </p>
                  ) : null,
                )}
              </div>
            )
          })}
        </div>
        <button type="button" className="mt-2 text-xs text-pleros-primary" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
          + Add line
        </button>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-pleros-white">Landed-cost estimates</legend>
        <p className="text-xs text-pleros-muted mt-1">On the PO, freight, duty and other may later move between each other but not total more than approved here.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(
            [
              ['freight', 'Freight', freight, setFreight],
              ['duty', 'Duty', duty, setDuty],
              ['other', 'Other', other, setOther],
            ] as const
          ).map(([key, label, value, set]) => (
            <div key={key}>
              <label htmlFor={fieldId(key)} className="block text-xs text-pleros-muted">
                {label} ({check.payload.currency || 'USD'})
              </label>
              <input
                id={fieldId(key)}
                className={`${input} mt-1`}
                inputMode="decimal"
                value={value}
                aria-invalid={!!err(key)}
                aria-describedby={describe(key)}
                onChange={(e) => set(e.target.value)}
              />
              {err(key) && <p id={`${fieldId(key)}-err`} className="text-xs text-red-400 mt-1">{err(key)}</p>}
            </div>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={fieldId('notes')} className="block text-xs text-pleros-muted">
          Notes
        </label>
        <textarea id={fieldId('notes')} className={`${input} mt-1`} rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="rounded-md border border-pleros-border p-3 text-sm">
        <dl className="grid grid-cols-2 gap-y-1 max-w-xs">
          <dt className="text-pleros-muted">Lines</dt>
          <dd className="text-right text-pleros-text">{formatAmount(check.lineTotal, check.payload.currency)}</dd>
          <dt className="text-pleros-muted">Landed estimates</dt>
          <dd className="text-right text-pleros-text">{formatAmount(check.landed, check.payload.currency)}</dd>
          <dt className="text-pleros-white font-semibold">Total</dt>
          <dd className="text-right text-pleros-white font-semibold">{formatAmount(check.total, check.payload.currency)}</dd>
        </dl>
        {check.blockers.length > 0 && (
          <div className="mt-3 text-xs text-pleros-muted">
            <p>You can save this as a draft. Before submitting for approval:</p>
            <ul className="list-disc ml-5 mt-1">
              {check.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {showErrors && (
        <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
          <p className="font-medium">Fix these before saving:</p>
          <ul className="list-disc ml-5 mt-1">
            {errorList.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {props.serverError && (
        <p role="alert" className="text-sm text-red-400">
          {props.serverError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={props.saving} aria-busy={props.saving}>
          {props.saving ? 'Saving…' : props.saveLabel}
        </button>
        {props.onCancel && (
          <button type="button" className="btn-ghost" disabled={props.saving} onClick={props.onCancel}>
            Discard changes
          </button>
        )}
      </div>
    </form>
  )
}
