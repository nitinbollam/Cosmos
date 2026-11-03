import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { api, gatewayApiBaseUrl } from '@/lib/api-admin'
import { authFetch, getSessionUser } from '@/lib/auth-session'
import { formatAmount, sumAmounts, toCents } from '@/lib/bank-recon-money'
import { EmptyState } from '@/components/pleros/empty-state'
import { StatusBadge } from '@/components/pleros/status-badge'

type BankAccountRow = {
  id: string
  name: string
  accountNumber?: string | null
  chartAccountId?: string | null
  currency?: string
}

type GlAccount = { id: string; code: string; name: string; type: string; isActive: boolean }

type Reconciliation = {
  id: string
  bankAccountId: string
  periodStart: string
  periodEnd: string
  statementOpeningBalance: string
  statementClosingBalance: string
  status: 'UNRECONCILED' | 'IN_PROGRESS' | 'SIGNED_OFF'
  dateWindowDays: number
  createdById: string
  preparedById: string | null
  preparedAt: string | null
  signedOffById: string | null
  signedOffAt: string | null
  version: number
  reopenedCount: number
}

type BookItem = { journalLineId: string; journalEntryId: string; date: string; description: string; memo: string | null; amount: string }
type BankItem = {
  statementLineId: string
  date: string
  description: string
  reference: string | null
  amount: string
  carriedForward: boolean
}
type MatchedLine = { date: string | null; description: string | null; amount: string }
type MatchGroup = {
  matchId: string
  type: 'AUTO' | 'MANUAL'
  createdById: string
  createdAt: string
  statementLines: (MatchedLine & { statementLineId: string })[]
  journalLines: (MatchedLine & { journalLineId: string })[]
}

type OtherPeriodMatch = {
  matchId: string
  periodStart: string
  periodEnd: string
  clearedAsOfThisPeriod: boolean
  createdById: string
  statementLines: (MatchedLine & { statementLineId: string })[]
  journalLines: (MatchedLine & { journalLineId: string })[]
}

type Workspace = {
  reconciliation: Reconciliation
  bankAccount: { id: string; name: string; accountNumberMasked: string | null; chartAccountId: string | null; currency: string }
  balances: Record<
    | 'bookBalance'
    | 'bankBalance'
    | 'depositsInTransit'
    | 'outstandingPayments'
    | 'unrecordedBankItems'
    | 'adjustedBook'
    | 'adjustedBank'
    | 'difference'
    | 'statementComputedClosing'
    | 'statementDifference',
    string
  >
  matched: MatchGroup[]
  otherPeriodMatches: OtherPeriodMatch[]
  unmatchedBook: BookItem[]
  unmatchedBank: BankItem[]
  autoMatchPreview: {
    dateWindowDays: number
    pairs: { statementLineId: string; journalLineId: string }[]
    ambiguousStatementLineIds: string[]
    ambiguousJournalLineIds: string[]
  }
  signOff: { canSignOff: boolean; blockers: string[] }
  people: Record<string, string>
}

type ReconEvent = {
  id: string
  action: string
  userId: string | null
  actorName: string
  metadata: Record<string, unknown> | null
  createdAt: string
}
type RowError = { row: number; message: string }
type Notice = { kind: 'ok' | 'error'; text: string; rows?: RowError[]; reasons?: string[] }

const QK = ['finance', 'bank-recon'] as const
/** Never show a raw user id: the server returns this label for users it cannot name. */
const UNKNOWN_USER = 'Deleted or unavailable user'

function statusOf(e: unknown): number | undefined {
  return (e as { response?: { status?: number } }).response?.status
}

/** Forbidden is final; other failures are retried a few times before the error state shows. */
const retryUnlessForbidden = (count: number, e: unknown) => statusOf(e) !== 403 && count < 3

/** A query that failed: forbidden is final; anything else can be retried. */
function LoadFailed({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  const text = errorOf(error).text
  if (statusOf(error) === 403) {
    return (
      <div className="text-sm" role="alert" style={{ color: 'var(--c-danger)' }}>
        You do not have permission to view {what}. ({text})
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" role="alert" style={{ color: 'var(--c-danger)' }}>
      <span className="min-w-0 break-words">
        Could not load {what}: {text}
      </span>
      <button type="button" className="btn-ghost !py-1 !px-2 !text-xs" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

function errorOf(e: unknown): Notice {
  const res = (e as { response?: { status?: number; data?: { message?: unknown; errors?: unknown } } }).response
  const message = typeof res?.data?.message === 'string' ? res.data.message : e instanceof Error ? e.message : 'Request failed'
  // `errors` is per-row CSV problems ({row, message}) or plain reasons (sign-off blockers).
  const errors: unknown[] = Array.isArray(res?.data?.errors) ? res.data.errors : []
  const rows = errors.filter((x): x is RowError => typeof x === 'object' && x !== null && typeof (x as RowError).row === 'number')
  const reasons = errors.filter((x): x is string => typeof x === 'string' && x !== message)
  return {
    kind: 'error',
    text: res?.status ? `${res.status}: ${message}` : message,
    rows: rows.length ? rows : undefined,
    reasons: reasons.length ? reasons : undefined,
  }
}

function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  const color = notice.kind === 'ok' ? 'var(--c-success)' : 'var(--c-danger)'
  return (
    <div className="text-sm space-y-1" role={notice.kind === 'error' ? 'alert' : 'status'} style={{ color }}>
      <div>{notice.text}</div>
      {notice.reasons?.length ? (
        <ul className="list-disc pl-5">
          {notice.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {notice.rows?.length ? (
        <table className="pleros-table">
          <thead>
            <tr>
              <th>Row</th>
              <th>Problem</th>
            </tr>
          </thead>
          <tbody>
            {notice.rows.map((r) => (
              <tr key={`${r.row}-${r.message}`}>
                <td className="font-mono">{r.row}</td>
                <td>{r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

function Metric({ label, value, currency, tone }: { label: string; value: string; currency: string; tone?: 'danger' | 'success' }) {
  const color = tone === 'danger' ? 'var(--c-danger)' : tone === 'success' ? 'var(--c-success)' : 'var(--c-heading)'
  return (
    <div className="pleros-card min-w-0">
      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
        {label}
      </div>
      <div className="text-lg font-mono font-semibold mt-1 break-all" style={{ color }}>
        {formatAmount(value, currency)}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold" style={{ color: 'var(--c-heading)' }}>
      {children}
    </h3>
  )
}

function lastDayOfPreviousMonth() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10)
}

function firstDayOfPreviousMonth() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10)
}

export function BankReconciliationTab() {
  const qc = useQueryClient()
  const me = getSessionUser()?.sub
  const [accountId, setAccountId] = useState('')
  const [reconId, setReconId] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: QK })
    void qc.invalidateQueries({ queryKey: ['finance', 'bank-summary'] })
    void qc.invalidateQueries({ queryKey: ['finance', 'bank-lines'] })
  }
  const fail = (e: unknown) => {
    setNotice(errorOf(e))
    // A conflict or lock means our view is stale: reload it.
    refresh()
  }

  const accountsQ = useQuery({
    queryKey: [...QK, 'accounts'],
    queryFn: () => api.get<BankAccountRow[]>('/bank-accounts'),
    retry: retryUnlessForbidden,
  })
  const accounts = accountsQ.data ?? []
  const account = accounts.find((a) => a.id === accountId)

  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(accounts[0]!.id)
  }, [accountId, accounts])

  const periodsQ = useQuery({
    queryKey: [...QK, 'periods', accountId],
    queryFn: () => api.get<Reconciliation[]>(`/bank-reconciliations?bankAccountId=${encodeURIComponent(accountId)}`),
    enabled: !!accountId,
    retry: retryUnlessForbidden,
  })
  const periods = periodsQ.data ?? []

  useEffect(() => {
    if (periodsQ.data && !periodsQ.data.some((p) => p.id === reconId)) setReconId(periodsQ.data[0]?.id ?? '')
  }, [periodsQ.data, reconId])

  const wsQ = useQuery({
    queryKey: [...QK, 'workspace', reconId],
    queryFn: () => api.get<Workspace>(`/bank-reconciliations/${encodeURIComponent(reconId)}`),
    enabled: !!reconId,
    retry: retryUnlessForbidden,
  })
  const eventsQ = useQuery({
    queryKey: [...QK, 'events', reconId],
    queryFn: () => api.get<ReconEvent[]>(`/bank-reconciliations/${encodeURIComponent(reconId)}/events`),
    enabled: !!reconId,
    retry: retryUnlessForbidden,
  })

  const glQ = useQuery({
    queryKey: [...QK, 'gl-accounts'],
    queryFn: () => api.get<GlAccount[]>('/chart-accounts'),
    enabled: !!account && !account.chartAccountId,
    retry: retryUnlessForbidden,
  })
  const glAssets = (glQ.data ?? []).filter((g) => g.type === 'ASSET' && g.isActive)
  const [glPick, setGlPick] = useState('')
  const linkGl = useMutation({
    mutationFn: () => api.patch(`/bank-accounts/${encodeURIComponent(accountId)}`, { chartAccountId: glPick }),
    onSuccess: () => {
      setNotice({ kind: 'ok', text: 'Bank account linked to its GL cash account.' })
      refresh()
    },
    onError: fail,
  })

  // New statement period
  const [showNew, setShowNew] = useState(false)
  const [draft, setDraft] = useState({
    periodStart: firstDayOfPreviousMonth(),
    periodEnd: lastDayOfPreviousMonth(),
    statementOpeningBalance: '0.00',
    statementClosingBalance: '0.00',
    dateWindowDays: '3',
  })
  const createPeriod = useMutation({
    mutationFn: () =>
      api.post<Reconciliation>('/bank-reconciliations', {
        bankAccountId: accountId,
        periodStart: draft.periodStart,
        periodEnd: draft.periodEnd,
        statementOpeningBalance: draft.statementOpeningBalance,
        statementClosingBalance: draft.statementClosingBalance,
        dateWindowDays: Number(draft.dateWindowDays),
      }),
    onSuccess: (r) => {
      setShowNew(false)
      setReconId(r.id)
      setNotice({ kind: 'ok', text: `Statement period ${r.periodStart} to ${r.periodEnd} created.` })
      refresh()
    },
    onError: fail,
  })

  const accountName = (id: string | null) => {
    if (!id) return '—'
    if (id === me) return 'You'
    return wsQ.data?.people[id] ?? UNKNOWN_USER
  }

  return (
    <section aria-label="Bank reconciliation" className="space-y-4 min-w-0">
      <div className="pleros-card space-y-3">
        <SectionTitle>Bank reconciliation</SectionTitle>
        {accountsQ.isLoading ? (
          <div className="skeleton h-10 w-full" />
        ) : accountsQ.isError ? (
          <LoadFailed what="bank accounts" error={accountsQ.error} onRetry={() => void accountsQ.refetch()} />
        ) : accounts.length === 0 ? (
          <EmptyState icon="🏦" title="No bank accounts" description="Create a bank account linked to a GL cash account to start reconciling." />
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs space-y-1 min-w-0 max-w-full" style={{ color: 'var(--c-text-3)' }}>
              Bank account
              <select
                aria-label="Bank account"
                className="pleros-input max-w-full"
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value)
                  setReconId('')
                  setNotice(null)
                }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs space-y-1 min-w-0 max-w-full" style={{ color: 'var(--c-text-3)' }}>
              Statement period
              <select
                aria-label="Statement period"
                className="pleros-input max-w-full"
                value={reconId}
                onChange={(e) => {
                  setReconId(e.target.value)
                  setNotice(null)
                }}
                disabled={!periods.length}
              >
                {periodsQ.isLoading && <option value="">Loading periods…</option>}
                {periodsQ.isError && <option value="">Periods could not be loaded</option>}
                {periodsQ.isSuccess && periods.length === 0 && <option value="">No periods yet</option>}
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.periodStart} to {p.periodEnd} · {p.status.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-ghost" disabled={!account?.chartAccountId} onClick={() => setShowNew((v) => !v)}>
              {showNew ? 'Cancel' : 'New statement period'}
            </button>
          </div>
        )}
        {periodsQ.isError && (
          <LoadFailed what="statement periods" error={periodsQ.error} onRetry={() => void periodsQ.refetch()} />
        )}

        {account && !account.chartAccountId && (
          <div className="flex flex-wrap items-end gap-3 text-sm" style={{ color: 'var(--c-warning)' }}>
            <span>This bank account is not linked to a GL cash account, so it has no book side yet.</span>
            {glQ.isError ? (
              <LoadFailed what="GL accounts" error={glQ.error} onRetry={() => void glQ.refetch()} />
            ) : (
              <>
                <select
                  aria-label="GL cash account"
                  className="pleros-input !w-auto max-w-full"
                  value={glPick}
                  disabled={!glQ.isSuccess}
                  onChange={(e) => setGlPick(e.target.value)}
                >
                  <option value="">
                    {glQ.isLoading
                      ? 'Loading GL accounts…'
                      : glAssets.length === 0
                        ? 'No active asset GL accounts; add one in Chart of accounts'
                        : 'Select an asset account'}
                  </option>
                  {glAssets.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.code} {g.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-primary" disabled={!glPick || linkGl.isPending} onClick={() => linkGl.mutate()}>
                  Link GL account
                </button>
              </>
            )}
          </div>
        )}

        {showNew && (
          <form
            className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
            onSubmit={(e) => {
              e.preventDefault()
              createPeriod.mutate()
            }}
          >
            {(
              [
                ['periodStart', 'Period start', 'date'],
                ['periodEnd', 'Period end', 'date'],
                ['statementOpeningBalance', 'Statement opening balance', 'text'],
                ['statementClosingBalance', 'Statement closing balance', 'text'],
                ['dateWindowDays', 'Auto-match window (days)', 'number'],
              ] as const
            ).map(([key, label, type]) => (
              <label key={key} className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                {label}
                <input
                  aria-label={label}
                  className="pleros-input"
                  type={type}
                  inputMode={type === 'text' ? 'decimal' : undefined}
                  value={draft[key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                />
              </label>
            ))}
            <button type="submit" className="btn-primary" disabled={createPeriod.isPending}>
              Create period
            </button>
          </form>
        )}
        <NoticeLine notice={notice} />
      </div>

      {reconId && wsQ.isLoading && <div className="skeleton h-48 w-full" />}
      {reconId && wsQ.isError && (
        <div className="pleros-card">
          <LoadFailed what="this reconciliation" error={wsQ.error} onRetry={() => void wsQ.refetch()} />
        </div>
      )}
      {wsQ.data && !wsQ.isError && (
        <ReconciliationWorkspace
          key={wsQ.data.reconciliation.id}
          ws={wsQ.data}
          events={eventsQ}
          who={accountName}
          onDone={(n) => {
            setNotice(n)
            refresh()
          }}
          onFail={fail}
        />
      )}
    </section>
  )
}

function ReconciliationWorkspace({
  ws,
  events,
  who,
  onDone,
  onFail,
}: {
  ws: Workspace
  events: UseQueryResult<ReconEvent[], unknown>
  who: (id: string | null) => string
  onDone: (n: Notice) => void
  onFail: (e: unknown) => void
}) {
  const r = ws.reconciliation
  const cur = ws.bankAccount.currency
  const locked = r.status === 'SIGNED_OFF'
  const base = `/bank-reconciliations/${encodeURIComponent(r.id)}`
  const [pdfBusy, setPdfBusy] = useState(false)

  const bankById = useMemo(() => new Map(ws.unmatchedBank.map((b) => [b.statementLineId, b])), [ws.unmatchedBank])
  const bookById = useMemo(() => new Map(ws.unmatchedBook.map((b) => [b.journalLineId, b])), [ws.unmatchedBook])
  const ambiguousBank = useMemo(() => new Set(ws.autoMatchPreview.ambiguousStatementLineIds), [ws.autoMatchPreview])
  const ambiguousBook = useMemo(() => new Set(ws.autoMatchPreview.ambiguousJournalLineIds), [ws.autoMatchPreview])

  // Statement balances and window
  const [edit, setEdit] = useState({
    statementOpeningBalance: r.statementOpeningBalance,
    statementClosingBalance: r.statementClosingBalance,
    dateWindowDays: String(r.dateWindowDays),
  })
  useEffect(() => {
    setEdit({
      statementOpeningBalance: r.statementOpeningBalance,
      statementClosingBalance: r.statementClosingBalance,
      dateWindowDays: String(r.dateWindowDays),
    })
  }, [r.statementOpeningBalance, r.statementClosingBalance, r.dateWindowDays])
  const update = useMutation({
    mutationFn: () =>
      api.patch(base, {
        statementOpeningBalance: edit.statementOpeningBalance,
        statementClosingBalance: edit.statementClosingBalance,
        dateWindowDays: Number(edit.dateWindowDays),
      }),
    onSuccess: () => onDone({ kind: 'ok', text: 'Statement balances saved.' }),
    onError: onFail,
  })

  // CSV import
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null)
  const [importNotice, setImportNotice] = useState<Notice | null>(null)
  const importCsv = useMutation({
    mutationFn: () =>
      api.post<{ rowCount: number; imported: number; skippedDuplicates: number; duplicateRows: number[] }>(`${base}/import-csv`, {
        csvText: csv!.text,
        fileName: csv!.name,
      }),
    onSuccess: (res) => {
      const dup = res.skippedDuplicates ? `, ${res.skippedDuplicates} duplicate row(s) skipped (rows ${res.duplicateRows.join(', ')})` : ''
      const n: Notice = { kind: 'ok', text: `Imported ${res.imported} of ${res.rowCount} row(s)${dup}.` }
      setImportNotice(n)
      setCsv(null)
      onDone(n)
    },
    onError: (e) => {
      setImportNotice(errorOf(e))
      onFail(e)
    },
  })

  // Auto-match
  const autoMatch = useMutation({
    mutationFn: () => api.post<{ matched: number; ambiguousStatementLineIds: string[] }>(`${base}/auto-match`, {}),
    onSuccess: (res) =>
      onDone({
        kind: 'ok',
        text: `Auto-match created ${res.matched} match(es). ${res.ambiguousStatementLineIds.length} ambiguous bank item(s) left for manual review.`,
      }),
    onError: onFail,
  })

  // Results shown next to the control that caused them (the tab-level notice is off screen here).
  const [matchNotice, setMatchNotice] = useState<Notice | null>(null)
  const [signNotice, setSignNotice] = useState<Notice | null>(null)
  const done = (set: (n: Notice) => void) => (n: Notice) => {
    set(n)
    onDone(n)
  }
  const failed = (set: (n: Notice) => void) => (e: unknown) => {
    set(errorOf(e))
    onFail(e)
  }

  // Manual match
  const [pickBank, setPickBank] = useState<Set<string>>(new Set())
  const [pickBook, setPickBook] = useState<Set<string>>(new Set())
  const bankTotal = sumAmounts([...pickBank].map((id) => bankById.get(id)?.amount ?? '0.00'))
  const bookTotal = sumAmounts([...pickBook].map((id) => bookById.get(id)?.amount ?? '0.00'))
  const totalsEqual = toCents(bankTotal) === toCents(bookTotal)
  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    apply(next)
  }
  const manualMatch = useMutation({
    mutationFn: () => api.post(`${base}/matches`, { statementLineIds: [...pickBank], journalLineIds: [...pickBook] }),
    onSuccess: () => {
      setPickBank(new Set())
      setPickBook(new Set())
      done(setMatchNotice)({ kind: 'ok', text: `Matched ${formatAmount(bankTotal, cur)}.` })
    },
    onError: failed(setMatchNotice),
  })

  // Unmatch
  const [unmatchId, setUnmatchId] = useState('')
  const [unmatchReason, setUnmatchReason] = useState('')
  const unmatch = useMutation({
    // POST alias of DELETE /matches/:id: the gateway client's delete() cannot send the reason.
    mutationFn: () => api.post(`${base}/matches/${encodeURIComponent(unmatchId)}/unmatch`, { reason: unmatchReason }),
    onSuccess: () => {
      setUnmatchId('')
      setUnmatchReason('')
      done(setMatchNotice)({ kind: 'ok', text: 'Match undone; both sides are open again.' })
    },
    onError: failed(setMatchNotice),
  })

  // Sign-off and reopen
  const signOff = useMutation({
    mutationFn: () => api.post(`${base}/sign-off`, { version: r.version }),
    onSuccess: () => done(setSignNotice)({ kind: 'ok', text: 'Reconciliation signed off. Its transactions are now locked.' }),
    onError: failed(setSignNotice),
  })
  const [reopenReason, setReopenReason] = useState('')
  const reopen = useMutation({
    mutationFn: () => api.post(`${base}/reopen`, { reason: reopenReason }),
    onSuccess: () => {
      setReopenReason('')
      done(setSignNotice)({ kind: 'ok', text: 'Reconciliation reopened. The reason is recorded in the audit trail.' })
    },
    onError: failed(setSignNotice),
  })

  async function downloadPdf() {
    setPdfBusy(true)
    try {
      const res = await authFetch(`${gatewayApiBaseUrl.replace(/\/$/, '')}${base}/pdf`, { headers: { Accept: 'application/pdf' } })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string }
        onFail({ response: { status: res.status, data: body } })
        return
      }
      const objectUrl = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `bank-reconciliation-${r.periodEnd}.pdf`
      a.click()
      URL.revokeObjectURL(objectUrl)
    } finally {
      setPdfBusy(false)
    }
  }

  const b = ws.balances
  const diffZero = toCents(b.difference) === 0n

  return (
    <div className="space-y-4">
      <div className="pleros-card flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold" style={{ color: 'var(--c-heading)' }}>
              {ws.bankAccount.name}
              {ws.bankAccount.accountNumberMasked ? ` (${ws.bankAccount.accountNumberMasked})` : ''}
            </span>
            <StatusBadge status={r.status} />
          </div>
          <div className="text-xs" style={{ color: 'var(--c-text-3)' }}>
            Period {r.periodStart} to {r.periodEnd} · version {r.version}
            {r.reopenedCount ? ` · reopened ${r.reopenedCount}×` : ''}
          </div>
          <div className="text-xs" style={{ color: 'var(--c-text-2)' }}>
            Prepared by {who(r.preparedById)}
            {r.preparedAt ? ` at ${new Date(r.preparedAt).toLocaleString()}` : ''}
          </div>
          <div className="text-xs" style={{ color: 'var(--c-text-2)' }}>
            Signed off by {who(r.signedOffById)}
            {r.signedOffAt ? ` at ${new Date(r.signedOffAt).toLocaleString()}` : ''}
          </div>
        </div>
        <button type="button" className="btn-ghost" disabled={pdfBusy} onClick={() => void downloadPdf()}>
          {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}
        </button>
      </div>

      {locked && (
        <div
          className="rounded-lg p-3 text-sm"
          role="status"
          style={{ background: 'var(--c-success-soft)', color: 'var(--c-success)', border: '1px solid var(--c-border)' }}
        >
          Signed off. Statement lines and ledger postings dated on or before {r.periodEnd} are locked: imports, matching, unmatching and
          backdated journal entries are refused until the period is reopened with a reason.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Book balance (GL)" value={b.bookBalance} currency={cur} />
        <Metric label="Statement closing balance" value={b.bankBalance} currency={cur} />
        <Metric label="Deposits in transit (+)" value={b.depositsInTransit} currency={cur} />
        <Metric label="Outstanding payments (−)" value={b.outstandingPayments} currency={cur} />
        <Metric label="Bank items not in books" value={b.unrecordedBankItems} currency={cur} />
        <Metric label="Adjusted book balance" value={b.adjustedBook} currency={cur} />
        <Metric label="Adjusted bank balance" value={b.adjustedBank} currency={cur} />
        <Metric label="Difference" value={b.difference} currency={cur} tone={diffZero ? 'success' : 'danger'} />
      </div>
      {toCents(b.statementDifference) !== 0n && (
        <p className="text-xs" style={{ color: 'var(--c-warning)' }}>
          Statement lines in this period roll forward to {formatAmount(b.statementComputedClosing, cur)}, which differs from the entered
          closing balance by {formatAmount(b.statementDifference, cur)}. Check for missing statement lines.
        </p>
      )}

      {!locked && (
        <div className="pleros-card space-y-3">
          <SectionTitle>Statement details</SectionTitle>
          <form
            className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
            onSubmit={(e) => {
              e.preventDefault()
              update.mutate()
            }}
          >
            {(
              [
                ['statementOpeningBalance', 'Statement opening balance'],
                ['statementClosingBalance', 'Statement closing balance'],
                ['dateWindowDays', 'Auto-match window (days)'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                {label}
                <input
                  aria-label={label}
                  className="pleros-input"
                  inputMode={key === 'dateWindowDays' ? 'numeric' : 'decimal'}
                  value={edit[key]}
                  onChange={(e) => setEdit((d) => ({ ...d, [key]: e.target.value }))}
                />
              </label>
            ))}
            <button type="submit" className="btn-ghost" disabled={update.isPending}>
              Save statement details
            </button>
          </form>
        </div>
      )}

      <div className="pleros-card space-y-3 overflow-x-auto">
        <SectionTitle>Import statement CSV</SectionTitle>
        <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
          Columns: date (YYYY-MM-DD), description, amount (+ money in, − money out) or debit/credit, optional reference. Every row is checked
          first; if any row fails, nothing is imported. The same file cannot be imported twice, and rows already on the account are skipped.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            aria-label="Statement CSV file"
            className="max-w-full"
            type="file"
            accept=".csv,text/csv"
            disabled={locked}
            onChange={(e) => {
              const file = e.target.files?.[0]
              setImportNotice(null)
              if (!file) return setCsv(null)
              void file.text().then((text) => setCsv({ name: file.name, text }))
              e.target.value = ''
            }}
          />
          <button type="button" className="btn-primary" disabled={!csv || importCsv.isPending} onClick={() => importCsv.mutate()}>
            {csv ? `Import ${csv.name}` : 'Import'}
          </button>
        </div>
        <NoticeLine notice={importNotice} />
      </div>

      <div className="pleros-card space-y-3 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>
            Suggested automatic matches ({ws.autoMatchPreview.pairs.length}) · same amount, within {ws.autoMatchPreview.dateWindowDays} day(s)
          </SectionTitle>
          <button
            type="button"
            className="btn-primary"
            disabled={locked || autoMatch.isPending || ws.autoMatchPreview.pairs.length === 0}
            onClick={() => autoMatch.mutate()}
          >
            Apply suggested matches
          </button>
        </div>
        {ws.autoMatchPreview.pairs.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
            No unambiguous suggestions.
          </p>
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Bank date</th>
                <th>Bank item</th>
                <th>Book date</th>
                <th>Book item</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {ws.autoMatchPreview.pairs.map((p) => {
                const bank = bankById.get(p.statementLineId)
                const book = bookById.get(p.journalLineId)
                return (
                  <tr key={`${p.statementLineId}-${p.journalLineId}`}>
                    <td className="whitespace-nowrap">{bank?.date}</td>
                    <td>{bank?.description}</td>
                    <td className="whitespace-nowrap">{book?.date}</td>
                    <td>{book?.description}</td>
                    <td className="text-right font-mono">{bank ? formatAmount(bank.amount, cur) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {ambiguousBank.size > 0 && (
          <p className="text-xs" style={{ color: 'var(--c-warning)' }}>
            {ambiguousBank.size} bank item(s) have more than one possible book match and are left for manual review (marked “ambiguous”
            below).
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="pleros-card space-y-2 overflow-x-auto">
          <SectionTitle>Unmatched bank items ({ws.unmatchedBank.length})</SectionTitle>
          {ws.unmatchedBank.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
              Every bank item is matched.
            </p>
          ) : (
            <table className="pleros-table">
              <thead>
                <tr>
                  <th />
                  <th>Date</th>
                  <th>Description</th>
                  <th>Ref</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ws.unmatchedBank.map((item) => (
                  <tr key={item.statementLineId}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select bank item ${item.description}`}
                        disabled={locked}
                        checked={pickBank.has(item.statementLineId)}
                        onChange={() => toggle(pickBank, item.statementLineId, setPickBank)}
                      />
                    </td>
                    <td className="whitespace-nowrap">{item.date}</td>
                    <td>
                      {item.description}
                      {item.carriedForward ? <span className="text-xs ml-2" style={{ color: 'var(--c-text-3)' }}>carried forward</span> : null}
                      {ambiguousBank.has(item.statementLineId) ? (
                        <span className="text-xs ml-2" style={{ color: 'var(--c-warning)' }}>
                          ambiguous
                        </span>
                      ) : null}
                    </td>
                    <td className="font-mono text-xs">{item.reference ?? ''}</td>
                    <td className="text-right font-mono">{formatAmount(item.amount, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="pleros-card space-y-2 overflow-x-auto">
          <SectionTitle>Unmatched book items ({ws.unmatchedBook.length})</SectionTitle>
          {ws.unmatchedBook.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
              Every book item is matched.
            </p>
          ) : (
            <table className="pleros-table">
              <thead>
                <tr>
                  <th />
                  <th>Date</th>
                  <th>Journal entry</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ws.unmatchedBook.map((item) => (
                  <tr key={item.journalLineId}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select book item ${item.description}`}
                        disabled={locked}
                        checked={pickBook.has(item.journalLineId)}
                        onChange={() => toggle(pickBook, item.journalLineId, setPickBook)}
                      />
                    </td>
                    <td className="whitespace-nowrap">{item.date}</td>
                    <td>
                      {item.description}
                      {ambiguousBook.has(item.journalLineId) ? (
                        <span className="text-xs ml-2" style={{ color: 'var(--c-warning)' }}>
                          ambiguous
                        </span>
                      ) : null}
                    </td>
                    <td className="text-right font-mono">{formatAmount(item.amount, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {!locked && (
        <div className="pleros-card flex flex-wrap items-center gap-4 text-sm">
          <span>
            Selected bank: <span className="font-mono">{formatAmount(bankTotal, cur)}</span> ({pickBank.size})
          </span>
          <span>
            Selected book: <span className="font-mono">{formatAmount(bookTotal, cur)}</span> ({pickBook.size})
          </span>
          {pickBank.size > 0 && pickBook.size > 0 && !totalsEqual && (
            <span style={{ color: 'var(--c-danger)' }}>Totals must be equal to match.</span>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!pickBank.size || !pickBook.size || !totalsEqual || manualMatch.isPending}
            onClick={() => manualMatch.mutate()}
          >
            Match selected
          </button>
          <NoticeLine notice={matchNotice} />
        </div>
      )}

      <div className="pleros-card space-y-2 overflow-x-auto">
        <SectionTitle>Matched ({ws.matched.length})</SectionTitle>
        {ws.matched.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
            Nothing matched yet.
          </p>
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Bank items</th>
                <th>Book items</th>
                <th className="text-right">Amount</th>
                <th>By</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ws.matched.map((m) => (
                <tr key={m.matchId}>
                  <td className="font-mono text-xs">{m.type}</td>
                  <td>
                    {m.statementLines.map((s) => (
                      <div key={s.statementLineId} className="text-xs">
                        {s.date} {s.description} <span className="font-mono">{formatAmount(s.amount, cur)}</span>
                      </div>
                    ))}
                  </td>
                  <td>
                    {m.journalLines.map((j) => (
                      <div key={j.journalLineId} className="text-xs">
                        {j.date} {j.description} <span className="font-mono">{formatAmount(j.amount, cur)}</span>
                      </div>
                    ))}
                  </td>
                  <td className="text-right font-mono">{formatAmount(sumAmounts(m.statementLines.map((s) => s.amount)), cur)}</td>
                  <td className="text-xs">{who(m.createdById)}</td>
                  <td>
                    {unmatchId === m.matchId ? (
                      <form
                        className="flex gap-2 items-center"
                        onSubmit={(e) => {
                          e.preventDefault()
                          unmatch.mutate()
                        }}
                      >
                        <input
                          aria-label="Reason for unmatching"
                          className="pleros-input !py-1 !text-xs"
                          placeholder="Reason (optional)"
                          value={unmatchReason}
                          onChange={(e) => setUnmatchReason(e.target.value)}
                        />
                        <button type="submit" className="btn-primary !py-1 !px-2 !text-xs" disabled={unmatch.isPending}>
                          Confirm
                        </button>
                        <button type="button" className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => setUnmatchId('')}>
                          Cancel
                        </button>
                      </form>
                    ) : locked ? (
                      <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                        locked
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn-ghost !py-1 !px-2 !text-xs"
                        onClick={() => {
                          setUnmatchId(m.matchId)
                          setUnmatchReason('')
                        }}
                      >
                        Unmatch
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {ws.otherPeriodMatches.length > 0 && (
        <div className="pleros-card space-y-2 overflow-x-auto">
          <SectionTitle>Matched in a later period ({ws.otherPeriodMatches.length})</SectionTitle>
          <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
            These items of this period are matched in a later statement period, so they cannot be matched here. A match whose items are all
            dated in or before this period clears them here too; otherwise they stay outstanding at this period end.
          </p>
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Matched in</th>
                <th>Bank items</th>
                <th>Book items</th>
                <th>Effect here</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {ws.otherPeriodMatches.map((m) => (
                <tr key={m.matchId}>
                  <td className="text-xs whitespace-nowrap">
                    {m.periodStart} to {m.periodEnd}
                  </td>
                  <td>
                    {m.statementLines.map((s) => (
                      <div key={s.statementLineId} className="text-xs">
                        {s.date} {s.description} <span className="font-mono">{formatAmount(s.amount, cur)}</span>
                      </div>
                    ))}
                  </td>
                  <td>
                    {m.journalLines.map((j) => (
                      <div key={j.journalLineId} className="text-xs">
                        {j.date} {j.description} <span className="font-mono">{formatAmount(j.amount, cur)}</span>
                      </div>
                    ))}
                  </td>
                  <td className="text-xs">{m.clearedAsOfThisPeriod ? 'Cleared as of this period' : 'Outstanding at this period end'}</td>
                  <td className="text-xs">{who(m.createdById)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pleros-card space-y-3">
        <SectionTitle>{locked ? 'Reopen' : 'Sign-off'}</SectionTitle>
        {!locked ? (
          <>
            {ws.signOff.blockers.length > 0 ? (
              <ul className="text-sm list-disc pl-5" style={{ color: 'var(--c-danger)' }}>
                {ws.signOff.blockers.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: 'var(--c-success)' }}>
                Adjusted book and adjusted bank balances agree. Ready to sign off.
              </p>
            )}
            {/* Kept clickable while blocked: the server is the authority and explains the refusal. */}
            <button type="button" className="btn-primary" disabled={signOff.isPending} onClick={() => signOff.mutate()}>
              Sign off reconciliation
            </button>
          </>
        ) : (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              reopen.mutate()
            }}
          >
            <label className="text-xs space-y-1 grow" style={{ color: 'var(--c-text-3)' }}>
              Reason for reopening (required, kept in the audit trail)
              <input
                aria-label="Reason for reopening"
                className="pleros-input"
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
              />
            </label>
            <button type="submit" className="btn-ghost" disabled={reopen.isPending}>
              Reopen period
            </button>
          </form>
        )}
        <NoticeLine notice={signNotice} />
      </div>

      <div className="pleros-card space-y-2 overflow-x-auto">
        <SectionTitle>Audit trail{events.data ? ` (${events.data.length})` : ''}</SectionTitle>
        {events.isError ? (
          <LoadFailed what="the audit trail" error={events.error} onRetry={() => void events.refetch()} />
        ) : events.isLoading ? (
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
            Loading the audit trail…
          </p>
        ) : !events.data?.length ? (
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
            No audit events yet.
          </p>
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>By</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {[...events.data].reverse().map((e) => (
                <tr key={e.id}>
                  <td className="text-xs whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="font-mono text-xs">{e.action}</td>
                  <td className="text-xs">{e.userId && who(e.userId) === 'You' ? 'You' : e.actorName}</td>
                  <td className="text-xs">{eventSummary(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function eventSummary(e: ReconEvent): string {
  const m = e.metadata ?? {}
  const pick = (k: string) => (m[k] === undefined || m[k] === null ? undefined : String(m[k]))
  switch (e.action) {
    case 'bank_statement.imported':
      return `${pick('imported')} of ${pick('rows')} row(s) imported`
    case 'bank_statement.duplicate_skipped':
      return `duplicate rows skipped: ${Array.isArray(m.rows) ? m.rows.join(', ') : ''}`
    case 'bank_recon.auto_matched':
      return `${pick('matched')} matched within ${pick('dateWindowDays')} day(s)`
    case 'bank_recon.matched':
      return `total ${pick('total')}`
    case 'bank_recon.unmatched':
      return pick('reason') ? `reason: ${pick('reason')}` : 'no reason given'
    case 'bank_recon.reopened':
      return `reason: ${pick('reason') ?? ''}`
    case 'bank_recon.signed_off': {
      const b = (m.balances ?? {}) as Record<string, string>
      return `adjusted book ${b.adjustedBook} = adjusted bank ${b.adjustedBank}; ${pick('lockedLines')} statement line(s) locked`
    }
    case 'bank_recon.updated': {
      const before = (m.before ?? {}) as Record<string, unknown>
      const after = (m.after ?? {}) as Record<string, unknown>
      return `closing ${before.closing} → ${after.closing}, opening ${before.opening} → ${after.opening}, window ${before.dateWindowDays} → ${after.dateWindowDays}`
    }
    case 'bank_statement.plaid_sync_blocked':
      return `${Array.isArray(m.transactions) ? m.transactions.length : 0} Plaid transaction(s) refused: dated in the period signed off through ${pick('lockedThrough')}; nothing saved, sync position kept`
    case 'bank_statement.plaid_synced':
      return `Plaid: ${pick('added')} added, ${pick('modified')} changed, ${pick('removed')} removed, ${pick('held')} held for review`
    case 'bank_recon.created':
      return `period ${pick('periodStart')} to ${pick('periodEnd')}, opening ${pick('opening')}, closing ${pick('closing')}`
    default:
      return ''
  }
}
