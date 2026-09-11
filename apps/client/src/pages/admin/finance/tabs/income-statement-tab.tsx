import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, gatewayApiBaseUrl } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'

type IncomeStatement = {
  fromIso: string
  toIso: string
  revenue: { total: number; byAccount: Array<{ code: string; name: string; amount: number }> }
  expenses: { total: number; byAccount: Array<{ code: string; name: string; amount: number }> }
  netIncome: number
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function defaultFromIso() {
  const d = new Date()
  return `${d.getFullYear()}-01-01`
}

function defaultToIso() {
  return new Date().toISOString().slice(0, 10)
}

export function IncomeStatementTab() {
  const [fromIso, setFromIso] = useState(defaultFromIso)
  const [toIso, setToIso] = useState(defaultToIso)
  const [applied, setApplied] = useState({ fromIso: defaultFromIso(), toIso: defaultToIso() })

  const statementQ = useQuery({
    queryKey: ['finance', 'income-statement', applied],
    queryFn: () =>
      api.get<IncomeStatement>(
        `/financial-statements/income-statement?fromIso=${encodeURIComponent(applied.fromIso)}&toIso=${encodeURIComponent(applied.toIso)}`,
      ),
  })

  async function downloadPdf() {
    const token = localStorage.getItem('pleros.accessToken')
    const base = gatewayApiBaseUrl.replace(/\/$/, '')
    const url = `${base}/financial-statements/income-statement/pdf?fromIso=${encodeURIComponent(applied.fromIso)}&toIso=${encodeURIComponent(applied.toIso)}`
    const res = await fetch(url, {
      headers: {
        Accept: 'application/pdf',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!res.ok) return
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = `income-statement-${applied.fromIso}-to-${applied.toIso}.pdf`
    a.click()
    URL.revokeObjectURL(objectUrl)
  }

  const data = statementQ.data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
          From
          <input type="date" className="pleros-input" value={fromIso} onChange={(e) => setFromIso(e.target.value)} />
        </label>
        <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
          To
          <input type="date" className="pleros-input" value={toIso} onChange={(e) => setToIso(e.target.value)} />
        </label>
        <button type="button" className="btn-ghost" onClick={() => setApplied({ fromIso, toIso })}>
          Run report
        </button>
        <button type="button" className="btn-primary" disabled={!data} onClick={() => void downloadPdf()}>
          Download PDF
        </button>
      </div>

      {statementQ.isLoading && <div className="skeleton h-48 w-full" />}
      {statementQ.isError && <p style={{ color: 'var(--c-danger)' }}>Could not load income statement.</p>}

      {data && (
        <div className="pleros-card space-y-6">
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
            Period: {data.fromIso} to {data.toIso}
          </p>

          <section>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--c-heading)' }}>
              Revenue
            </h3>
            {(data.revenue.byAccount.length ?? 0) === 0 ? (
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                No revenue posted in this period.
              </p>
            ) : (
              <table className="pleros-table">
                <tbody>
                  {data.revenue.byAccount.map((row) => (
                    <tr key={row.code}>
                      <td className="font-mono text-xs">{row.code}</td>
                      <td>{row.name}</td>
                      <td className="text-right font-mono">{money(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-sm font-semibold mt-2 text-right font-mono" style={{ color: 'var(--c-heading)' }}>
              Total revenue: {money(data.revenue.total)}
            </p>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--c-heading)' }}>
              Expenses
            </h3>
            {(data.expenses.byAccount.length ?? 0) === 0 ? (
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                No expenses posted in this period.
              </p>
            ) : (
              <table className="pleros-table">
                <tbody>
                  {data.expenses.byAccount.map((row) => (
                    <tr key={row.code}>
                      <td className="font-mono text-xs">{row.code}</td>
                      <td>{row.name}</td>
                      <td className="text-right font-mono">{money(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-sm font-semibold mt-2 text-right font-mono" style={{ color: 'var(--c-heading)' }}>
              Total expenses: {money(data.expenses.total)}
            </p>
          </section>

          <div
            className="rounded-lg p-4 flex justify-between items-center"
            style={{ background: 'var(--c-accent-dim)', border: '1px solid var(--c-border)' }}
          >
            <span className="font-semibold" style={{ color: 'var(--c-heading)' }}>
              Net income
            </span>
            <span className="text-xl font-mono font-bold" style={{ color: 'var(--c-heading)' }}>
              {money(data.netIncome)}
            </span>
          </div>

          {data.revenue.byAccount.length === 0 && data.expenses.byAccount.length === 0 && (
            <EmptyState icon="📊" title="No activity in period" description="Post journal entries to revenue and expense accounts to populate the income statement." />
          )}
        </div>
      )}
    </div>
  )
}
