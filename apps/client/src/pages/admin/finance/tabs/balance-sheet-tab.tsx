import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'

type BalanceSheet = {
  asOfIso: string
  assets: { total: number; byAccount: Array<{ code: string; name: string; amount: number }> }
  liabilities: { total: number; byAccount: Array<{ code: string; name: string; amount: number }> }
  equity: {
    total: number
    retainedEarnings: number
    byAccount: Array<{ code: string; name: string; amount: number }>
  }
  balanced: boolean
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function Section({
  title,
  rows,
  total,
}: {
  title: string
  rows: Array<{ code: string; name: string; amount: number }>
  total: number
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--c-heading)' }}>
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
          No balances.
        </p>
      ) : (
        <table className="pleros-table">
          <tbody>
            {rows.map((row) => (
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
        Total {title.toLowerCase()}: {money(total)}
      </p>
    </section>
  )
}

export function BalanceSheetTab() {
  const [asOfIso, setAsOfIso] = useState(new Date().toISOString().slice(0, 10))
  const [applied, setApplied] = useState(asOfIso)

  const sheetQ = useQuery({
    queryKey: ['finance', 'balance-sheet', applied],
    queryFn: () => api.get<BalanceSheet>(`/financial-statements/balance-sheet?asOfIso=${encodeURIComponent(applied)}`),
  })

  const data = sheetQ.data
  const liabilitiesPlusEquity = (data?.liabilities.total ?? 0) + (data?.equity.total ?? 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
          As of
          <input type="date" className="pleros-input" value={asOfIso} onChange={(e) => setAsOfIso(e.target.value)} />
        </label>
        <button type="button" className="btn-ghost" onClick={() => setApplied(asOfIso)}>
          Run report
        </button>
      </div>

      {sheetQ.isLoading && <div className="skeleton h-48 w-full" />}
      {sheetQ.isError && <p style={{ color: 'var(--c-danger)' }}>Could not load balance sheet.</p>}

      {data && !data.balanced && (
        <div className="pleros-card text-sm" style={{ borderColor: 'var(--c-danger)', color: 'var(--c-danger)' }}>
          Balance sheet does not balance — contact support. Assets {money(data.assets.total)} vs liabilities + equity{' '}
          {money(liabilitiesPlusEquity)}.
        </div>
      )}

      {data && (
        <div className="pleros-card space-y-6">
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
            As of {data.asOfIso}
          </p>

          <Section title="Assets" rows={data.assets.byAccount} total={data.assets.total} />
          <Section title="Liabilities" rows={data.liabilities.byAccount} total={data.liabilities.total} />

          <section>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--c-heading)' }}>
              Equity
            </h3>
            {data.equity.byAccount.length > 0 && (
              <table className="pleros-table">
                <tbody>
                  {data.equity.byAccount.map((row) => (
                    <tr key={row.code}>
                      <td className="font-mono text-xs">{row.code}</td>
                      <td>{row.name}</td>
                      <td className="text-right font-mono">{money(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <table className="pleros-table mt-2">
              <tbody>
                <tr>
                  <td className="font-mono text-xs">RE</td>
                  <td>Retained earnings</td>
                  <td className="text-right font-mono">{money(data.equity.retainedEarnings)}</td>
                </tr>
              </tbody>
            </table>
            <p className="text-sm font-semibold mt-2 text-right font-mono" style={{ color: 'var(--c-heading)' }}>
              Total equity: {money(data.equity.total)}
            </p>
          </section>

          <div
            className="rounded-lg p-4 flex justify-between items-center"
            style={{ background: 'var(--c-accent-dim)', border: '1px solid var(--c-border)' }}
          >
            <span className="font-semibold" style={{ color: 'var(--c-heading)' }}>
              Total liabilities + equity
            </span>
            <span className="text-xl font-mono font-bold" style={{ color: 'var(--c-heading)' }}>
              {money(liabilitiesPlusEquity)}
            </span>
          </div>

          {data.assets.byAccount.length === 0 &&
            data.liabilities.byAccount.length === 0 &&
            data.equity.byAccount.length === 0 &&
            Math.abs(data.equity.retainedEarnings) < 0.005 && (
              <EmptyState icon="⚖️" title="No balances yet" description="Posted journal entries will appear on the balance sheet." />
            )}
        </div>
      )}
    </div>
  )
}
