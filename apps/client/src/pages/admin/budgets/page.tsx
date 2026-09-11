import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'

type ChartAccount = { id: string; code: string; name: string }
type BudgetLine = { accountId: string; month: number; budgetedAmount: string | number }
type Budget = { id: string; name: string; fiscalYear: number; lines: BudgetLine[] }

type VsActualRow = {
  accountId: string
  code: string
  name: string
  month: number
  budgeted: number
  actual: number
  variance: number
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export default function BudgetsPage() {
  const qc = useQueryClient()
  const [budgetId, setBudgetId] = useState('')
  const [name, setName] = useState('')
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear())
  const [grid, setGrid] = useState<Record<string, Record<number, string>>>({})

  const accountsQ = useQuery<ChartAccount[]>({
    queryKey: ['chart-accounts'],
    queryFn: () => api.get('/chart-accounts'),
  })

  const budgetsQ = useQuery<Budget[]>({
    queryKey: ['budgets'],
    queryFn: () => api.get('/budgets'),
  })

  const selected = budgetsQ.data?.find((b) => b.id === budgetId) ?? budgetsQ.data?.[0]

  const vsActualQ = useQuery<{ rows: VsActualRow[] }>({
    queryKey: ['budget-vs-actual', selected?.id],
    queryFn: () => api.get(`/budgets/${encodeURIComponent(selected!.id)}/vs-actual`),
    enabled: !!selected?.id,
  })

  const expenseAccounts = useMemo(
    () => (accountsQ.data ?? []).filter((a) => !a.code.startsWith('1') && !a.code.startsWith('2')),
    [accountsQ.data],
  )

  const createMut = useMutation({
    mutationFn: () => api.post('/budgets', { name, fiscalYear }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['budgets'] })
      setName('')
    },
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!selected) return
      const lines: Array<{ accountId: string; month: number; budgetedAmount: number }> = []
      for (const acct of expenseAccounts) {
        for (const month of MONTHS) {
          const raw = grid[acct.id]?.[month]
          if (raw == null || raw.trim() === '') continue
          lines.push({ accountId: acct.id, month, budgetedAmount: Number(raw) })
        }
      }
      await api.post(`/budgets/${encodeURIComponent(selected.id)}/lines`, { lines })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['budgets'] })
      void qc.invalidateQueries({ queryKey: ['budget-vs-actual'] })
    },
  })

  function onPaste(e: React.ClipboardEvent<HTMLTableElement>) {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    const rows = text.split(/\r?\n/).filter(Boolean)
    const next = { ...grid }
    rows.forEach((row, rowIdx) => {
      const acct = expenseAccounts[rowIdx]
      if (!acct) return
      const cells = row.split('\t')
      cells.forEach((cell, colIdx) => {
        const month = MONTHS[colIdx]
        if (!month) return
        next[acct.id] = { ...(next[acct.id] ?? {}), [month]: cell.trim() }
      })
    })
    setGrid(next)
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-pleros-white">Budgets</h1>
        <p className="text-pleros-muted text-sm mt-1">Paste spreadsheet data into the grid (tab-separated columns, newline-separated rows).</p>
      </div>

      <Card>
        <CardTitle>Create budget</CardTitle>
        <div className="flex flex-wrap gap-3 mt-3">
          <input className="pleros-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="pleros-input w-28" type="number" value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))} />
          <button type="button" className="btn-primary" disabled={!name.trim() || createMut.isPending} onClick={() => createMut.mutate()}>
            Create
          </button>
        </div>
      </Card>

      {budgetsQ.data?.length ? (
        <Card>
          <CardTitle>Budget grid</CardTitle>
          <select className="pleros-input !w-auto mt-3" value={selected?.id ?? ''} onChange={(e) => setBudgetId(e.target.value)}>
            {budgetsQ.data.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.fiscalYear})
              </option>
            ))}
          </select>
          <div className="overflow-auto mt-4">
            <table className="w-full text-sm" onPaste={onPaste}>
              <thead>
                <tr>
                  <th className="text-left p-2">Account</th>
                  {MONTHS.map((m) => (
                    <th key={m} className="p-2">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {expenseAccounts.slice(0, 20).map((acct) => (
                  <tr key={acct.id}>
                    <td className="p-2 whitespace-nowrap">
                      {acct.code} {acct.name}
                    </td>
                    {MONTHS.map((month) => (
                      <td key={month} className="p-1">
                        <input
                          className="pleros-input !w-20 !text-xs"
                          value={grid[acct.id]?.[month] ?? ''}
                          onChange={(e) =>
                            setGrid((prev) => ({
                              ...prev,
                              [acct.id]: { ...(prev[acct.id] ?? {}), [month]: e.target.value },
                            }))
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn-primary mt-4" disabled={saveMut.isPending || !selected} onClick={() => saveMut.mutate()}>
            Save lines
          </button>
        </Card>
      ) : null}

      {vsActualQ.data?.rows.length ? (
        <Card>
          <CardTitle>Budget vs actual</CardTitle>
          <div className="overflow-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left p-2">Account</th>
                  <th className="p-2">Month</th>
                  <th className="p-2">Budgeted</th>
                  <th className="p-2">Actual</th>
                  <th className="p-2">Variance</th>
                </tr>
              </thead>
              <tbody>
                {vsActualQ.data.rows.map((r) => (
                  <tr key={`${r.accountId}-${r.month}`}>
                    <td className="p-2">
                      {r.code} {r.name}
                    </td>
                    <td className="p-2 text-center">{r.month}</td>
                    <td className="p-2 text-right">${r.budgeted.toFixed(2)}</td>
                    <td className="p-2 text-right">${r.actual.toFixed(2)}</td>
                    <td className="p-2 text-right">${r.variance.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  )
}
