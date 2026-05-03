'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'

type Report = {
  id: string
  manufacturerDid: string
  weekEnding: string
  status: string
}

type TaxSummary = { totalNet: number | string | null; count: number }

export default function CompliancePage() {
  const qc = useQueryClient()

  const reports = useQuery<Report[]>({
    queryKey: ['msa', 'reports', 'full'],
    queryFn: () => api.get('/msa/reports'),
    refetchInterval: 120_000,
  })

  const tax = useQuery<TaxSummary>({
    queryKey: ['tax', 'summary'],
    queryFn: () => api.get('/tax/summary'),
  })

  const generate = useMutation({
    mutationFn: () => api.post(`/msa/reports/generate?weekOffset=0`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['msa', 'reports', 'full'] }),
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-cosmos-white">Compliance</h1>
        <p className="text-cosmos-muted text-sm mt-1">MSA reports and tax rollup.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardTitle>Tax exposure (approx)</CardTitle>
          <p className="text-3xl font-semibold text-cosmos-white mt-3">
            ${Number(tax.data?.totalNet ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-cosmos-muted mt-2">{tax.data?.count ?? 0} MSA-linked rows</p>
        </Card>
        <Card>
          <CardTitle>MSA actions</CardTitle>
          <button
            type="button"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="mt-4 h-10 w-full rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
          >
            {generate.isPending ? 'Generating…' : 'Generate weekly MSA drafts'}
          </button>
          {generate.error && (
            <p className="text-red-400 text-xs mt-2">{String((generate.error as Error).message)}</p>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle>Reports</CardTitle>
        {reports.isLoading ? (
          <p className="text-sm text-cosmos-muted mt-3">Loading…</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                  <th className="pb-2 pr-4">Manufacturer DID</th>
                  <th className="pb-2 pr-4">Week ending</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(reports.data ?? []).slice(0, 50).map((r) => (
                  <tr key={r.id} className="border-b border-cosmos-border/60">
                    <td className="py-2 pr-4 font-mono text-xs">{r.manufacturerDid}</td>
                    <td className="py-2 pr-4 text-cosmos-muted">
                      {new Date(r.weekEnding).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-cosmos-accent">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
