import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'

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
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const active = reports.find((r) => r.id === activeId) ?? reports[0] ?? null

  async function reload() {
    setReports(await api.get<ExpenseReport[]>('/expense-reports'))
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

  async function addLine() {
    if (!active) return
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/expense-reports/${encodeURIComponent(active.id)}/lines`, {
        category,
        amount: Number(amount),
        description,
        incurredAt,
      })
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
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <p>
        <Link to="/account" className="pleros-shop-link-accent">
          ← Account
        </Link>
      </p>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>Expense reports</h1>
      {err ? <p style={{ color: 'var(--c-danger)' }}>{err}</p> : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void createReport()}>
          New report
        </button>
      </div>

      {reports.length ? (
        <div style={{ marginTop: 16 }}>
          <select className="pleros-input" value={active?.id ?? ''} onChange={(e) => setActiveId(e.target.value)}>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.status} · ${Number(r.totalAmount).toFixed(2)} · {r.lines.length} lines
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {active?.status === 'DRAFT' ? (
        <div className="pleros-card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Add line</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            <select className="pleros-input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input className="pleros-input" type="number" min={0} step="0.01" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <input className="pleros-input" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
            <input className="pleros-input" type="date" value={incurredAt} onChange={(e) => setIncurredAt(e.target.value)} />
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void addLine()}>
              Add line
            </button>
          </div>
          {active.lines.length ? (
            <ul style={{ marginTop: 16, paddingLeft: 18 }}>
              {active.lines.map((l) => (
                <li key={l.id}>
                  {l.category} · ${Number(l.amount).toFixed(2)} · {l.description}
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="btn-primary" style={{ marginTop: 16 }} disabled={busy || !active.lines.length} onClick={() => void submitReport()}>
            Submit for approval
          </button>
        </div>
      ) : active ? (
        <p style={{ marginTop: 16, color: 'var(--c-text-3)' }}>Report status: {active.status}</p>
      ) : null}
    </div>
  )
}
