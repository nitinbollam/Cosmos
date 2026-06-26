import { Link } from 'react-router-dom'
import {
  closestCorners,
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'
import { SpreadsheetImportPanel } from '@/components/pleros/spreadsheet-import-panel'
import { rowNumber, rowValue, type BulkImportResult, type SpreadsheetRow } from '@/lib/spreadsheet-import'

const KANBAN_COLUMNS = [
  { id: 'NEW', label: 'New' },
  { id: 'CONTACTED', label: 'Contacted' },
  { id: 'QUALIFIED', label: 'Qualified' },
  { id: 'PROPOSAL', label: 'Proposal' },
  { id: 'NEGOTIATION', label: 'Negotiation' },
  { id: 'WON', label: 'Won' },
  { id: 'LOST', label: 'Lost' },
] as const

const COLUMN_IDS = new Set<string>(KANBAN_COLUMNS.map((c) => c.id))

function normalizeLeadStatus(status: string) {
  return COLUMN_IDS.has(status) ? status : 'NEW'
}

type LeadRow = {
  id: string
  companyName: string
  contactName?: string | null
  email?: string | null
  status: string
  source?: string | null
  pipelineValue?: string | number | null
  assignedToUserId?: string | null
  createdAt: string
  customer?: { id: string; name: string } | null
}

type CustomerRow = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  customerKind?: string | null
  creditLimit?: string | number | null
  creditUsed?: string | number | null
  paymentTermsDays?: number | null
  salesRepUserId?: string | null
}

type UserRow = {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  role: string
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

function money(n: number) {
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function userLabel(u: UserRow) {
  const n = [u.firstName, u.lastName].filter(Boolean).join(' ')
  return n || u.email
}

export default function CrmPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'customers' | 'leads'>('customers')

  const leadsQ = useQuery<LeadRow[]>({
    queryKey: ['leads'],
    queryFn: () => api.get('/leads'),
    enabled: tab === 'leads',
  })

  const usersQ = useQuery<{ items: UserRow[] }>({
    queryKey: ['users', 'crm'],
    queryFn: () => api.get('/users?page=1&pageSize=200'),
    enabled: tab === 'customers' || tab === 'leads',
  })

  const repById = useMemo(() => {
    const m = new Map<string, UserRow>()
    for (const u of usersQ.data?.items ?? []) m.set(u.id, u)
    return m
  }, [usersQ.data])

  return (
    <div className="p-6 space-y-6" style={{ fontFamily: 'var(--font-body)' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-pleros-white" style={{ fontFamily: 'var(--font-display)' }}>
            CRM
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>Customers and pipeline — real-time from crm-service</p>
        </div>
        <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--c-border)' }}>
          {(['customers', 'leads'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-semibold capitalize ${tab === id ? 'btn-primary !rounded-none' : 'btn-ghost !rounded-none !border-0'}`}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      {tab === 'customers' && (
        <CustomersSection
          repById={repById}
          users={usersQ.data?.items ?? []}
          usersLoading={usersQ.isLoading}
          onInvalidateCustomers={() => void qc.invalidateQueries({ queryKey: ['customers'] })}
        />
      )}

      {tab === 'leads' && (
        <LeadsKanbanSection
          leads={leadsQ.data ?? []}
          loading={leadsQ.isLoading}
          error={leadsQ.isError}
          repById={repById}
          onInvalidateLeads={() => void qc.invalidateQueries({ queryKey: ['leads', 'customers'] })}
        />
      )}
    </div>
  )
}

const CUSTOMERS_PAGE_SIZE = 25

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>): void {
  const lines = [headers.join(','), ...rows.map((r) => r.map(csvEscape).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

type CustomersPage = { items: CustomerRow[]; total: number; page: number; pageSize: number }

function CustomersSection(props: {
  repById: Map<string, UserRow>
  users: UserRow[]
  usersLoading: boolean
  onInvalidateCustomers: () => void
}) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const customersQ = useQuery<CustomersPage>({
    queryKey: ['customers', page, debounced],
    queryFn: () =>
      api.get(
        `/customers?page=${page}&pageSize=${CUSTOMERS_PAGE_SIZE}${debounced ? `&search=${encodeURIComponent(debounced)}` : ''}`,
      ),
    placeholderData: (prev) => prev,
  })

  const filtered = customersQ.data?.items ?? []
  const total = customersQ.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / CUSTOMERS_PAGE_SIZE))

  async function exportCsv() {
    setExporting(true)
    try {
      const all = await api.get<CustomerRow[]>('/customers')
      downloadCsv(
        `customers-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Name', 'Email', 'Phone', 'Type', 'Credit limit', 'Credit used', 'Payment terms (days)', 'Sales rep'],
        all.map((c) => [
          c.name,
          c.email ?? '',
          c.phone ?? '',
          c.customerKind ?? 'BUSINESS',
          c.creditLimit ?? '',
          c.creditUsed ?? '',
          c.paymentTermsDays ?? '',
          c.salesRepUserId ? (props.repById.get(c.salesRepUserId) ? userLabel(props.repById.get(c.salesRepUserId)!) : '') : '',
        ]),
      )
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          className="pleros-input max-w-md"
          placeholder="Search company, email, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="btn-primary" onClick={() => setDrawerOpen(true)}>
          New customer
        </button>
        <button type="button" className="btn-ghost" onClick={() => setImportOpen((open) => !open)}>
          {importOpen ? 'Hide import' : 'Import CSV/Excel'}
        </button>
        <button type="button" className="btn-ghost" disabled={exporting} onClick={() => void exportCsv()}>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {importOpen ? (
        <SpreadsheetImportPanel
          title="Import customers"
          expectedColumns={[
            'name',
            'email',
            'phone',
            'customerKind',
            'creditLimit',
            'paymentTermsDays',
            'primaryAddressLine1',
            'primaryCity',
            'primaryState',
            'primaryZip',
          ]}
          templateFilename="customers-import-template.csv"
          onImport={async (rows) => {
            const payload = rows
              .map((row) => {
                const name = rowValue(row, 'name', 'companyName', 'company')
                if (!name) return null
                const creditLimit = rowNumber(row, 'creditLimit', 'credit_limit')
                const paymentTermsDays = rowNumber(row, 'paymentTermsDays', 'payment_terms_days', 'terms')
                const kind = rowValue(row, 'customerKind', 'customer_kind', 'type').toUpperCase()
                return {
                  name,
                  email: rowValue(row, 'email') || undefined,
                  phone: rowValue(row, 'phone') || undefined,
                  customerKind:
                    kind === 'INDIVIDUAL' || kind === 'BUSINESS'
                      ? (kind as 'INDIVIDUAL' | 'BUSINESS')
                      : undefined,
                  creditLimit,
                  paymentTermsDays: paymentTermsDays != null ? Math.trunc(paymentTermsDays) : undefined,
                  primaryAddressLine1: rowValue(row, 'primaryAddressLine1', 'address', 'address1') || undefined,
                  primaryCity: rowValue(row, 'primaryCity', 'city') || undefined,
                  primaryState: rowValue(row, 'primaryState', 'state') || undefined,
                  primaryZip: rowValue(row, 'primaryZip', 'zip', 'postalCode') || undefined,
                }
              })
              .filter((row): row is NonNullable<typeof row> => row != null)
            const result = await api.post<BulkImportResult>('/customers/import', { rows: payload })
            props.onInvalidateCustomers()
            return result
          }}
        />
      ) : null}

      <div className="pleros-card overflow-x-auto">
        {customersQ.isLoading ? (
          <div className="skeleton h-40 w-full" />
        ) : customersQ.isError ? (
          <p style={{ color: 'var(--c-danger)' }}>Could not load customers.</p>
        ) : filtered.length === 0 ? (
          <EmptyState icon="🏢" title="No customers" description="Add a customer with the button above." />
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Credit</th>
                <th>Terms</th>
                <th>Rep</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const limit = c.creditLimit != null ? Number(c.creditLimit) : 0
                const used = c.creditUsed != null ? Number(c.creditUsed) : 0
                const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
                let barColor = 'var(--c-success)'
                if (pct >= 80) barColor = 'var(--c-danger)'
                else if (pct >= 60) barColor = 'var(--c-warning)'
                const rep = c.salesRepUserId ? props.repById.get(c.salesRepUserId) : undefined
                return (
                  <tr key={c.id}>
                    <td>
                      <Link to={adminPath(`/crm/customers/${c.id}`)} className="font-semibold" style={{ color: 'var(--c-text)' }}>
                        {c.name}
                      </Link>
                      {c.customerKind === 'INDIVIDUAL' ? (
                        <span className="ml-2">
                          <StatusBadge status="INDIVIDUAL" />
                        </span>
                      ) : null}
                    </td>
                    <td className="text-sm" style={{ color: 'var(--c-text-2)' }}>
                      {c.email ?? '—'}
                      {c.phone ? <div>{c.phone}</div> : null}
                    </td>
                    <td style={{ minWidth: 140 }}>
                      {limit > 0 ? (
                        <>
                          <div className="h-2 rounded-full overflow-hidden mt-1" style={{ background: 'var(--c-surface-2)' }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                          </div>
                          <div className="text-xs font-mono mt-1" style={{ color: 'var(--c-text-3)' }}>
                            {money(used)} / {money(limit)}
                          </div>
                        </>
                      ) : (
                        <span className="text-sm" style={{ color: 'var(--c-text-3)' }}>—</span>
                      )}
                    </td>
                    <td className="text-sm">{c.paymentTermsDays != null ? `${c.paymentTermsDays} d` : '—'}</td>
                    <td className="text-sm" style={{ color: 'var(--c-text-2)' }}>
                      {rep ? userLabel(rep) : '—'}
                    </td>
                    <td>
                      <Link to={adminPath(`/crm/customers/${c.id}`)} style={{ color: 'var(--c-accent)' }} className="text-sm font-semibold">
                        View
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {total > CUSTOMERS_PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--c-text-2)' }}>
          <span>
            Page {page} of {totalPages} · {total} customer{total === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost !py-1 !px-3 !text-xs"
              disabled={page <= 1 || customersQ.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <button
              type="button"
              className="btn-ghost !py-1 !px-3 !text-xs"
              disabled={page >= totalPages || customersQ.isFetching}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next →
            </button>
          </div>
        </div>
      ) : null}

      {drawerOpen && (
        <NewCustomerDrawer
          salesReps={props.users.filter((u) => u.role === 'SALES_REP')}
          usersLoading={props.usersLoading}
          onClose={() => setDrawerOpen(false)}
          onSaved={() => {
            setDrawerOpen(false)
            props.onInvalidateCustomers()
          }}
        />
      )}
    </>
  )
}

function NewCustomerDrawer(props: {
  salesReps: UserRow[]
  usersLoading: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [customerKind, setCustomerKind] = useState<'BUSINESS' | 'INDIVIDUAL'>('BUSINESS')
  const [name, setName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [taxId, setTaxId] = useState('')
  const [isTobacco, setIsTobacco] = useState(false)
  const [license, setLicense] = useState('')
  const [creditLimit, setCreditLimit] = useState('')
  const [creditUsed, setCreditUsed] = useState('0')
  const [terms, setTerms] = useState('0')
  const [salesRepUserId, setSalesRepUserId] = useState('')
  const [addr1, setAddr1] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')

  const create = useMutation({
    mutationFn: () => {
      const displayName =
        customerKind === 'BUSINESS'
          ? name.trim()
          : [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || 'Customer'
      return api.post('/customers', {
        name: displayName,
        customerKind,
        firstName: customerKind === 'INDIVIDUAL' ? firstName.trim() || undefined : undefined,
        lastName: customerKind === 'INDIVIDUAL' ? lastName.trim() || undefined : undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        taxId: taxId.trim() || undefined,
        isLicensedTobacco: isTobacco,
        tobaccoLicenseNumber: isTobacco ? license.trim() || undefined : undefined,
        creditLimit: creditLimit.trim() ? parseFloat(creditLimit) : undefined,
        creditUsed: creditUsed.trim() ? parseFloat(creditUsed) : 0,
        paymentTermsDays: terms.trim() ? parseInt(terms, 10) : 0,
        salesRepUserId: salesRepUserId || undefined,
        primaryAddressLine1: addr1.trim() || undefined,
        primaryCity: city.trim() || undefined,
        primaryState: state.trim() || undefined,
        primaryZip: zip.trim() || undefined,
      })
    },
    onSuccess: () => props.onSaved(),
  })

  const valid =
    customerKind === 'BUSINESS'
      ? name.trim().length > 0
      : firstName.trim().length > 0 || lastName.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" className="flex-1 bg-black/60" aria-label="Close" onClick={props.onClose} />
      <div
        className="w-full max-w-lg overflow-y-auto border-l p-6"
        style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
      >
        <h2 className="text-lg font-bold" style={{ color: 'var(--c-heading)', fontFamily: 'var(--font-display)' }}>
          New customer
        </h2>
        <label className="block text-xs mt-4" style={{ color: 'var(--c-text-3)' }}>Type</label>
        <select
          className="pleros-input mt-1"
          value={customerKind}
          onChange={(e) => setCustomerKind(e.target.value as 'BUSINESS' | 'INDIVIDUAL')}
        >
          <option value="BUSINESS">Business</option>
          <option value="INDIVIDUAL">Individual</option>
        </select>

        {customerKind === 'BUSINESS' ? (
          <>
            <label className="block text-xs mt-3" style={{ color: 'var(--c-text-3)' }}>Company name *</label>
            <input className="pleros-input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div>
              <label className="block text-xs" style={{ color: 'var(--c-text-3)' }}>First name</label>
              <input className="pleros-input mt-1" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs" style={{ color: 'var(--c-text-3)' }}>Last name</label>
              <input className="pleros-input mt-1" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
        )}

        <label className="block text-xs mt-3" style={{ color: 'var(--c-text-3)' }}>Email</label>
        <input className="pleros-input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="block text-xs mt-3" style={{ color: 'var(--c-text-3)' }}>Phone</label>
        <input className="pleros-input mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label className="block text-xs mt-3" style={{ color: 'var(--c-text-3)' }}>Tax ID</label>
        <input className="pleros-input mt-1" value={taxId} onChange={(e) => setTaxId(e.target.value)} />

        <label className="flex items-center gap-2 mt-4 text-sm" style={{ color: 'var(--c-text)' }}>
          <input type="checkbox" checked={isTobacco} onChange={(e) => setIsTobacco(e.target.checked)} />
          Licensed tobacco
        </label>
        {isTobacco ? (
          <>
            <label className="block text-xs mt-2" style={{ color: 'var(--c-text-3)' }}>License #</label>
            <input className="pleros-input mt-1" value={license} onChange={(e) => setLicense(e.target.value)} />
          </>
        ) : null}

        <div className="grid grid-cols-2 gap-2 mt-3">
          <div>
            <label className="block text-xs" style={{ color: 'var(--c-text-3)' }}>Credit limit</label>
            <input className="pleros-input mt-1" type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs" style={{ color: 'var(--c-text-3)' }}>Credit used</label>
            <input className="pleros-input mt-1" type="number" value={creditUsed} onChange={(e) => setCreditUsed(e.target.value)} />
          </div>
        </div>
        <label className="block text-xs mt-3" style={{ color: 'var(--c-text-3)' }}>Payment terms (days, 0 = prepay)</label>
        <input className="pleros-input mt-1" type="number" value={terms} onChange={(e) => setTerms(e.target.value)} />

        <label className="block text-xs mt-3" style={{ color: 'var(--c-text-3)' }}>Sales rep</label>
        <select
          className="pleros-input mt-1"
          value={salesRepUserId}
          onChange={(e) => setSalesRepUserId(e.target.value)}
          disabled={props.usersLoading}
        >
          <option value="">—</option>
          {props.salesReps.map((u) => (
            <option key={u.id} value={u.id}>{userLabel(u)}</option>
          ))}
        </select>

        <label className="block text-xs mt-4" style={{ color: 'var(--c-text-3)' }}>Primary address</label>
        <input className="pleros-input mt-1" placeholder="Line 1" value={addr1} onChange={(e) => setAddr1(e.target.value)} />
        <div className="grid grid-cols-3 gap-2 mt-2">
          <input className="pleros-input" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
          <input className="pleros-input" placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
          <input className="pleros-input" placeholder="ZIP" value={zip} onChange={(e) => setZip(e.target.value)} />
        </div>

        {create.error && <p className="text-sm mt-3" style={{ color: 'var(--c-danger)' }}>{errMsg(create.error)}</p>}

        <div className="flex gap-2 mt-6">
          <button type="button" className="btn-ghost flex-1" onClick={props.onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={!valid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Saving…' : 'Create customer'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LeadsKanbanSection(props: {
  leads: LeadRow[]
  loading: boolean
  error: boolean
  repById: Map<string, UserRow>
  onInvalidateLeads: () => void
}) {
  const qc = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [activeDrag, setActiveDrag] = useState<LeadRow | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const normalizedLeads = useMemo(
    () => props.leads.map((l) => ({ ...l, status: normalizeLeadStatus(l.status) })),
    [props.leads],
  )

  const byColumn = useMemo(() => {
    const m: Record<string, LeadRow[]> = {}
    for (const c of KANBAN_COLUMNS) m[c.id] = []
    for (const l of normalizedLeads) {
      const col = normalizeLeadStatus(l.status)
      if (!m[col]) m[col] = []
      m[col].push(l)
    }
    return m
  }, [normalizedLeads])

  const patchStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/leads/${encodeURIComponent(id)}`, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['leads'] })
      const prev = qc.getQueryData<LeadRow[]>(['leads'])
      qc.setQueryData<LeadRow[]>(['leads'], (old) =>
        (old ?? []).map((l) => (l.id === id ? { ...l, status } : l)),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['leads'], ctx.prev)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveDrag(null)
      const { active, over } = e
      if (!over) return
      const leadId = String(active.id)
      let overId = String(over.id)
      let targetCol: string | null = COLUMN_IDS.has(overId) ? overId : null
      if (!targetCol) {
        const targetLead = normalizedLeads.find((l) => l.id === overId)
        targetCol = targetLead ? normalizeLeadStatus(targetLead.status) : null
      }
      if (!targetCol || !COLUMN_IDS.has(targetCol)) return
      const lead = normalizedLeads.find((l) => l.id === leadId)
      if (!lead || lead.status === targetCol) return
      patchStatus.mutate({ id: leadId, status: targetCol })
    },
    [normalizedLeads, patchStatus],
  )

  const totals = useMemo(() => {
    const value: Record<string, number> = {}
    for (const c of KANBAN_COLUMNS) value[c.id] = 0
    for (const l of normalizedLeads) {
      const v = l.pipelineValue != null ? Number(l.pipelineValue) : 0
      value[l.status] = (value[l.status] ?? 0) + v
    }
    return value
  }, [normalizedLeads])

  return (
    <>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => setImportOpen((open) => !open)}>
          {importOpen ? 'Hide import' : 'Import CSV/Excel'}
        </button>
        <button type="button" className="btn-primary" onClick={() => setDrawerOpen(true)}>
          New lead
        </button>
      </div>

      {importOpen ? (
        <SpreadsheetImportPanel
          title="Import leads into pipeline stages"
          hint="Set status to NEW, CONTACTED, QUALIFIED, PROPOSAL, NEGOTIATION, WON, or LOST."
          expectedColumns={[
            'companyName',
            'contactName',
            'email',
            'source',
            'pipelineValue',
            'status',
          ]}
          templateFilename="leads-import-template.csv"
          onImport={async (rows) => {
            const payload = rows
              .map((row) => {
                const companyName = rowValue(row, 'companyName', 'company', 'name')
                if (!companyName) return null
                const status = rowValue(row, 'status', 'stage', 'pipelineStage').toUpperCase()
                const pipelineValue = rowNumber(row, 'pipelineValue', 'pipeline_value', 'value')
                return {
                  companyName,
                  contactName: rowValue(row, 'contactName', 'contact') || undefined,
                  email: rowValue(row, 'email') || undefined,
                  source: rowValue(row, 'source') || undefined,
                  pipelineValue,
                  status: COLUMN_IDS.has(status) ? status : undefined,
                }
              })
              .filter((row): row is NonNullable<typeof row> => row != null)
            const result = await api.post<BulkImportResult>('/leads/import', { rows: payload })
            props.onInvalidateLeads()
            return result
          }}
        />
      ) : null}

      {drawerOpen && (
        <NewLeadDrawer
          onClose={() => setDrawerOpen(false)}
          onSaved={() => {
            setDrawerOpen(false)
            props.onInvalidateLeads()
          }}
        />
      )}

      {props.loading ? (
        <div className="skeleton h-96 w-full" />
      ) : props.error ? (
        <p style={{ color: 'var(--c-danger)' }}>Could not load leads.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={(e) => {
          const l = normalizedLeads.find((x) => x.id === String(e.active.id))
          setActiveDrag(l ?? null)
        }} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 480 }}>
            {KANBAN_COLUMNS.map((col) => (
              <KanbanColumn key={col.id} columnId={col.id} label={col.label} count={byColumn[col.id]?.length ?? 0} sum={totals[col.id] ?? 0}>
                {(byColumn[col.id] ?? []).map((lead) => (
                  <LeadKanbanCard key={lead.id} lead={lead} repById={props.repById} onConverted={props.onInvalidateLeads} />
                ))}
              </KanbanColumn>
            ))}
          </div>
          <DragOverlay>
            {activeDrag ? (
              <div className="pleros-card opacity-95 shadow-xl" style={{ width: 260 }}>
                <p className="font-semibold" style={{ color: 'var(--c-text)' }}>{activeDrag.companyName}</p>
                <StatusBadge status={activeDrag.status} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </>
  )
}

function KanbanColumn({
  columnId,
  label,
  count,
  sum,
  children,
}: {
  columnId: string
  label: string
  count: number
  sum: number
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId })
  return (
    <div
      ref={setNodeRef}
      className="shrink-0 rounded-xl p-2 flex flex-col gap-2 w-[280px]"
      style={{
        background: 'var(--c-surface)',
        border: `1px solid ${isOver ? 'var(--c-accent)' : 'var(--c-border-card)'}`,
        minHeight: 400,
      }}
    >
      <div className="px-2 py-2 border-b" style={{ borderColor: 'var(--c-border-card)' }}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-display font-bold text-sm" style={{ color: 'var(--c-heading)' }}>{label}</span>
          <span className="text-xs font-mono px-2 py-0.5 rounded-full" style={{ background: 'var(--c-primary-dim)', color: 'var(--c-primary)' }}>
            {count}
          </span>
        </div>
        <div className="text-xs mt-1 font-mono" style={{ color: 'var(--c-text-3)' }}>{money(sum)} pipeline</div>
      </div>
      <div className="flex flex-col gap-2 flex-1 overflow-y-auto max-h-[70vh]">
        {children}
      </div>
    </div>
  )
}

function LeadKanbanCard({
  lead,
  repById,
  onConverted,
}: {
  lead: LeadRow
  repById: Map<string, UserRow>
  onConverted: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
  })
  const qc = useQueryClient()
  const [convertOpen, setConvertOpen] = useState(false)
  const [custName, setCustName] = useState(lead.companyName)

  const convert = useMutation({
    mutationFn: () => api.post(`/leads/${encodeURIComponent(lead.id)}/convert`, { customerName: custName.trim() }),
    onSuccess: () => {
      setConvertOpen(false)
      onConverted()
      void qc.invalidateQueries({ queryKey: ['customers'] })
    },
  })

  const rep = lead.assignedToUserId ? repById.get(lead.assignedToUserId) : undefined
  const pv = lead.pipelineValue != null ? Number(lead.pipelineValue) : 0
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.5 : 1 }
    : { opacity: isDragging ? 0.5 : 1 }

  const canConvert = !lead.customer && lead.status !== 'LOST' && lead.status !== 'WON'

  return (
    <>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className="pleros-card cursor-grab active:cursor-grabbing"
        style={{ ...style, padding: 12 }}
      >
        <p className="font-semibold text-sm leading-tight" style={{ color: 'var(--c-text)' }}>{lead.companyName}</p>
        {lead.contactName ? <p className="text-xs mt-1" style={{ color: 'var(--c-text-2)' }}>{lead.contactName}</p> : null}
        {lead.email ? <p className=" text-xs font-mono mt-0.5" style={{ color: 'var(--c-text-3)' }}>{lead.email}</p> : null}
        {lead.source ? <p className="text-[11px] mt-1 uppercase tracking-wide" style={{ color: 'var(--c-accent)' }}>{lead.source}</p> : null}
        {rep ? <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>Rep: {userLabel(rep)}</p> : null}
        {pv > 0 ? <p className="text-xs font-mono mt-1" style={{ color: 'var(--c-heading)' }}>{money(pv)}</p> : null}
        <p className="text-[10px] mt-2" style={{ color: 'var(--c-text-3)' }}>{new Date(lead.createdAt).toLocaleDateString()}</p>
        <div className="flex flex-wrap gap-2 mt-2 items-center">
          <StatusBadge status={lead.status} />
          {lead.customer ? (
            <Link
              to={adminPath(`/crm/customers/${lead.customer.id}`)}
              className="text-xs"
              style={{ color: 'var(--c-accent)' }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              Customer
            </Link>
          ) : null}
        </div>
        {canConvert ? (
          <button
            type="button"
            className="btn-ghost w-full mt-2 !py-1.5 !text-xs"
            onClick={(e) => {
              e.stopPropagation()
              setConvertOpen(true)
            }}
          >
            Convert to customer
          </button>
        ) : null}
      </div>

      {convertOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="pleros-card max-w-sm w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold" style={{ color: 'var(--c-heading)' }}>Convert lead</h3>
            <label className="text-xs" style={{ color: 'var(--c-text-3)' }}>Customer / account name</label>
            <input className="pleros-input" value={custName} onChange={(e) => setCustName(e.target.value)} />
            {convert.error && <p className="text-sm" style={{ color: 'var(--c-danger)' }}>{errMsg(convert.error)}</p>}
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1" onClick={() => setConvertOpen(false)}>Cancel</button>
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={!custName.trim() || convert.isPending}
                onClick={() => convert.mutate()}
              >
                {convert.isPending ? '…' : 'Convert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function NewLeadDrawer(props: { onClose: () => void; onSaved: () => void }) {
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [source, setSource] = useState('WEB')
  const [pipelineValue, setPipelineValue] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api.post('/leads', {
        companyName: companyName.trim(),
        contactName: contactName.trim() || undefined,
        email: email.trim() || undefined,
        source: source.trim() || undefined,
        pipelineValue: pipelineValue.trim() ? parseFloat(pipelineValue) : undefined,
      }),
    onSuccess: () => props.onSaved(),
  })

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" className="flex-1 bg-black/60" aria-label="Close" onClick={props.onClose} />
      <div className="w-full max-w-md border-l p-6 overflow-y-auto" style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}>
        <h2 className="text-lg font-bold font-display" style={{ color: 'var(--c-heading)' }}>New lead</h2>
        <label className="block text-xs mt-4" style={{ color: 'var(--c-text-3)' }}>Company *</label>
        <input className="pleros-input mt-1" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        <label className="block text-xs mt-3" style={{ color: 'var(--c-text-3)' }}>Contact name</label>
        <input className="pleros-input mt-1" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        <label className="block text-xs mt-3" style={{ color: 'var(--c-text-3)' }}>Email</label>
        <input className="pleros-input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="block text-xs mt-3" style={{ color: 'var(--c-text-3)' }}>Source</label>
        <select className="pleros-input mt-1" value={source} onChange={(e) => setSource(e.target.value)}>
          {['WEB', 'REFERRAL', 'TRADE_SHOW', 'COLD_CALL', 'OTHER'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label className="block text-xs mt-3" style={{ color: 'var(--c-text-3)' }}>Pipeline value</label>
        <input className="pleros-input mt-1" type="number" value={pipelineValue} onChange={(e) => setPipelineValue(e.target.value)} />
        {create.error && <p className="text-sm mt-3" style={{ color: 'var(--c-danger)' }}>{errMsg(create.error)}</p>}
        <div className="flex gap-2 mt-6">
          <button type="button" className="btn-ghost flex-1" onClick={props.onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={!companyName.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Saving…' : 'Create lead'}
          </button>
        </div>
      </div>
    </div>
  )
}
