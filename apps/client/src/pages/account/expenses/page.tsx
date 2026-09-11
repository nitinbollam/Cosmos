import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'
import { StatusBadge } from '@/components/pleros/status-badge'

type ExpenseLine = {
  id: string
  category: string
  amount: string | number
  description: string
  incurredAt: string
  receiptUrl?: string | null
}

type ExpenseReport = {
  id: string
  status: string
  totalAmount: string | number
  rejectReason?: string | null
  submittedAt?: string | null
  decidedAt?: string | null
  lines: ExpenseLine[]
}

const CATEGORIES = ['TRAVEL', 'MEALS', 'SUPPLIES', 'MILEAGE', 'OTHER']

export default function ExpenseReportsPage() {
  const [reports, setReports] = useState<ExpenseReport[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [category, setCategory] = useState('TRAVEL')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [incurredAt, setIncurredAt] = useState(new Date().toISOString().slice(0, 10))
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const active = reports.find((r) => r.id === activeId) ?? reports[0] ?? null

  async function reload() {
    const list = await api.get<ExpenseReport[]>('/expense-reports')
    setReports(list)
  }

  useEffect(() => {
    void reload().catch(() => setReports([]))
  }, [])

  async function createReport() {
    setBusy(true)
    setErr(null)
    try {
      const row = await api.post<ExpenseReport>('/expense-reports', {})
      setReports((prev) => [row, ...prev])
      setActiveId(row.id)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        const base64 = result.includes(',') ? result.split(',')[1] : result
        resolve(base64)
      }
      reader.onerror = () => reject(new Error('Failed to read receipt file'))
      reader.readAsDataURL(file)
    })
  }

  async function addLine() {
    if (!active) return
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErr('Enter a valid positive expense amount')
      return
    }
    if (!description.trim()) {
      setErr('Description is required')
      return
    }

    setBusy(true)
    setErr(null)
    try {
      let receiptUrl: string | undefined
      if (receiptFile) {
        const base64 = await fileToBase64(receiptFile)
        const uploadRes = await api.post<{ url: string }>('/expense-reports/receipts', {
          fileName: receiptFile.name,
          mimeType: receiptFile.type,
          contentBase64: base64,
        })
        receiptUrl = uploadRes.url
      }

      await api.post(`/expense-reports/${encodeURIComponent(active.id)}/lines`, {
        category,
        amount: parsedAmount,
        description: description.trim(),
        incurredAt,
        receiptUrl,
      })
      setAmount('')
      setDescription('')
      setReceiptFile(null)
      await reload()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function removeLine(lineId: string) {
    if (!active) return
    setBusy(true)
    setErr(null)
    try {
      await api.delete(
        `/expense-reports/${encodeURIComponent(active.id)}/lines/${encodeURIComponent(lineId)}`,
      )
      await reload()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function submitReport() {
    if (!active) return
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/expense-reports/${encodeURIComponent(active.id)}/submit`, {})
      await reload()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-pleros-text-3 mb-1">
            <Link to="/account" className="text-pleros-accent hover:underline">
              ← Account
            </Link>
          </p>
          <h1 className="text-2xl font-bold font-display text-pleros-white">Expense reports</h1>
          <p className="text-xs text-pleros-text-3 mt-1">Submit employee expenses and track reimbursement status.</p>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void createReport()}
        >
          New report
        </button>
      </div>

      {err ? (
        <div className="p-3 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-sm">
          {err}
        </div>
      ) : null}

      {reports.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-pleros-text-3">Select report:</label>
          <select
            className="pleros-input !w-auto"
            value={active?.id ?? ''}
            onChange={(e) => setActiveId(e.target.value)}
          >
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.status} · ${Number(r.totalAmount).toFixed(2)} · {r.lines.length} line(s)
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {active ? (
        <div className="pleros-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-pleros-border">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-pleros-white">Report #{active.id.slice(-6)}</span>
                <StatusBadge status={active.status} />
              </div>
              <p className="text-xs text-pleros-text-3 mt-0.5">
                Total amount: <strong className="text-pleros-white">${Number(active.totalAmount).toFixed(2)}</strong>
              </p>
            </div>
            {active.status === 'DRAFT' ? (
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={busy || !active.lines.length}
                onClick={() => void submitReport()}
              >
                Submit for approval
              </button>
            ) : null}
          </div>

          {active.status === 'REJECTED' && active.rejectReason ? (
            <div className="p-3 rounded bg-red-950/30 border border-red-800 text-red-300 text-xs">
              <strong>Rejection reason:</strong> {active.rejectReason}
            </div>
          ) : null}

          {active.status === 'DRAFT' ? (
            <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 space-y-3">
              <h2 className="text-sm font-medium text-pleros-white">Add expense line</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-pleros-text-3">Category</label>
                  <select
                    className="pleros-input w-full mt-1"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-pleros-text-3">Amount ($)</label>
                  <input
                    className="pleros-input w-full mt-1"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-pleros-text-3">Date incurred</label>
                  <input
                    className="pleros-input w-full mt-1"
                    type="date"
                    value={incurredAt}
                    onChange={(e) => setIncurredAt(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-pleros-text-3">Receipt (image or PDF, max 5MB)</label>
                  <input
                    className="pleros-input w-full mt-1 text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-zinc-800 file:text-zinc-200"
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-pleros-text-3">Description</label>
                  <input
                    className="pleros-input w-full mt-1"
                    placeholder="Business purpose or item details"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={busy}
                onClick={() => void addLine()}
              >
                Add line
              </button>
            </div>
          ) : null}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-pleros-text-3 mb-2">
              Expense Lines ({active.lines.length})
            </h3>
            {active.lines.length === 0 ? (
              <p className="text-xs text-pleros-text-3 italic">No expense lines added yet.</p>
            ) : (
              <ul className="space-y-2">
                {active.lines.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-zinc-900/40 border border-zinc-800"
                  >
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium text-pleros-white">
                        {l.category} · ${Number(l.amount).toFixed(2)}
                      </div>
                      <div className="text-xs text-pleros-text-3">
                        {l.description} · {new Date(l.incurredAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {l.receiptUrl ? (
                        <a
                          href={l.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-pleros-accent hover:underline"
                        >
                          View receipt ↗
                        </a>
                      ) : null}
                      {active.status === 'DRAFT' ? (
                        <button
                          type="button"
                          className="text-xs text-red-400 hover:text-red-300"
                          disabled={busy}
                          onClick={() => void removeLine(l.id)}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="pleros-card text-center py-12 text-pleros-text-3 text-sm">
          No expense reports found. Click &quot;New report&quot; to get started.
        </div>
      )}
    </div>
  )
}
