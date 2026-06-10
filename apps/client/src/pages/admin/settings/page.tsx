import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useQueryParams } from '@/lib/use-query-params'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/cosmos/empty-state'
import { CosmosDialogModal, CosmosSheet } from '@/components/cosmos/radix-overlays'
import { WebhookManager } from '@/components/settings/webhook-manager'

type TenantMe = {
  id: string
  slug: string
  displayName: string
  plan: string
  industry?: string
  timeZone: string
  billingEmail?: string | null
  suspended: boolean
  onboardingSteps?: Array<{ stepKey: string; completed: boolean }>
}

type UserRow = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  isActive: boolean
  lastLoginAt?: string | null
  createdAt?: string
}

type UsersPage = { items: UserRow[]; total: number; page: number; pageSize: number }

type InviteRow = {
  id: string
  email: string
  role: string
  expiresAt: string
  createdAt: string
}

type WarehouseRow = {
  id: string
  name: string
  code: string
  address: Record<string, unknown>
  isActive: boolean
  isDefault: boolean
}

type MsaConfig = {
  id: string
  tenantId: string
  reporterDid: string
  msaEnabled: boolean
  manufacturerDids: Array<{
    id: string
    manufacturerDid: string
    manufacturerName: string
    ediEndpoint?: string | null
    autoSubmit: boolean
    isActive: boolean
  }>
} | null

type StripeStatus = {
  webhookSigningSecretConfigured: boolean
  rotation: string
}

type NotificationProviderStatus = {
  email: { provider: string; configured: boolean; fromEmail: string }
  sms: { provider: string; configured: boolean; fromNumberMasked: string | null }
  webhook: { configured: boolean }
  activeFallback: string
  setupNote: string
}

type TabId = 'company' | 'users' | 'warehouses' | 'integrations' | 'billing' | 'features' | 'audit'

const STEP_LABELS: Record<string, string> = {
  ORG_PROFILE: 'Organization profile',
  BILLING_CONTACT: 'Billing contact',
  FIRST_WAREHOUSE: 'First warehouse',
  COMPLIANCE_ACK: 'Compliance acknowledgement',
}

const INVITE_ROLES = [
  'STAFF',
  'VIEWER',
  'MANAGER',
  'WAREHOUSE_STAFF',
  'SALES_REP',
  'DRIVER',
  'ACCOUNTANT',
  'TENANT_ADMIN',
] as const

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

const TAB_IDS: TabId[] = ['company', 'users', 'warehouses', 'integrations', 'billing', 'features', 'audit']

function tabFromSearchParams(raw: string | null): TabId {
  if (raw && TAB_IDS.includes(raw as TabId)) return raw as TabId
  return 'company'
}

export default function SettingsPage() {
  const qc = useQueryClient()
  const searchParams = useQueryParams()
  const [tab, setTab] = useState<TabId>(() => tabFromSearchParams(searchParams.get('tab')))

  useEffect(() => {
    setTab(tabFromSearchParams(searchParams.get('tab')))
  }, [searchParams])

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-cosmos-white" style={{ fontFamily: 'var(--font-display)' }}>
          Settings
        </h1>
        <p className="text-cosmos-text-3 text-sm mt-1">Company profile, people, warehouses, integrations, and plan</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2" style={{ borderColor: 'var(--c-border)' }}>
        {(
          [
            ['company', 'Company'],
            ['users', 'Users'],
            ['warehouses', 'Warehouses'],
            ['integrations', 'Integrations'],
            ['billing', 'Billing'],
            ['features', 'Features'],
            ['audit', 'Audit log'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? 'btn-primary !py-2 !px-3' : 'btn-ghost !py-2 !px-3'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'company' && <CompanyTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'warehouses' && <WarehousesTab />}
      {tab === 'integrations' && <IntegrationsTab />}
      {tab === 'billing' && <BillingTab />}
      {tab === 'features' && <FeaturesTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  )
}

function CompanyTab() {
  const qc = useQueryClient()
  const tenant = useQuery<TenantMe>({
    queryKey: ['tenant-me'],
    queryFn: () => api.get('/tenants/me'),
  })
  const [displayName, setDisplayName] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [timeZone, setTimeZone] = useState('')
  const [industry, setIndustry] = useState('GENERAL_WHOLESALE')

  useEffect(() => {
    const t = tenant.data
    if (!t) return
    setDisplayName(t.displayName)
    setBillingEmail(t.billingEmail ?? '')
    setTimeZone(t.timeZone)
    setIndustry(t.industry ?? 'GENERAL_WHOLESALE')
  }, [tenant.data])

  const patch = useMutation({
    mutationFn: (body: {
      displayName: string
      billingEmail?: string | null
      timeZone: string
      industry: string
    }) => api.patch('/tenants/me', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-me'] }),
  })

  const patchStep = useMutation({
    mutationFn: ({ stepKey, completed }: { stepKey: string; completed: boolean }) =>
      api.patch(`/tenants/me/onboarding-steps/${encodeURIComponent(stepKey)}`, { completed }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-me'] }),
  })

  return (
    <div className="space-y-6">
      <div className="cosmos-card">
        <h2 className="text-cosmos-white font-semibold font-display mb-1">Company profile</h2>
        <p className="text-cosmos-text-3 text-sm mb-4">Updates your tenant via PATCH /tenants/me</p>
        {tenant.isLoading ? (
          <div className="skeleton h-24 w-full" />
        ) : tenant.error || !tenant.data ? (
          <p className="text-sm" style={{ color: 'var(--c-danger)' }}>
            Could not load tenant.
          </p>
        ) : (
          <form
            className="space-y-4 max-w-xl"
            onSubmit={(e) => {
              e.preventDefault()
              patch.mutate({
                displayName: displayName.trim(),
                billingEmail: billingEmail.trim() ? billingEmail.trim() : null,
                timeZone: timeZone.trim() || tenant.data.timeZone,
                industry,
              })
            }}
          >
            <div>
              <label className="text-xs text-cosmos-text-3">Slug (read-only)</label>
              <input className="cosmos-input mt-1 opacity-70" readOnly value={tenant.data.slug} />
            </div>
            <div>
              <label className="text-xs text-cosmos-text-3">Display name</label>
              <input className="cosmos-input mt-1" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-cosmos-text-3">Billing email</label>
              <input
                className="cosmos-input mt-1"
                type="email"
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="text-xs text-cosmos-text-3">Time zone</label>
              <input
                className="cosmos-input mt-1"
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                placeholder="e.g. America/New_York"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider mb-1 text-cosmos-text-3">
                Industry Vertical
              </label>
              <select
                className="cosmos-input w-full max-w-xs"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              >
                <option value="GENERAL_WHOLESALE">General Wholesale</option>
                <option value="TOBACCO_VAPE">Tobacco &amp; Vape</option>
                <option value="PHARMA">Pharmaceutical</option>
                <option value="FOOD_BEVERAGE">Food &amp; Beverage</option>
                <option value="ALCOHOL">Alcohol Distribution</option>
              </select>
              <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>
                Controls which compliance engine runs for your account.
              </p>
            </div>
            {tenant.data.suspended && <p className="text-amber-400 text-sm">This tenant is suspended.</p>}
            {patch.error && <p className="text-red-400 text-sm">{errMsg(patch.error)}</p>}
            <button type="submit" className="btn-primary" disabled={!displayName.trim() || patch.isPending}>
              {patch.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        )}
      </div>

      <TaxSettingsCard />

      {tenant.data?.onboardingSteps && tenant.data.onboardingSteps.length > 0 && (
        <div className="cosmos-card">
          <h2 className="text-cosmos-white font-semibold font-display mb-1">Onboarding</h2>
          <p className="text-cosmos-text-3 text-sm mb-4">Mark steps your organization has finished</p>
          <ul className="space-y-2 text-sm">
            {tenant.data.onboardingSteps.map((s) => (
              <li
                key={s.stepKey}
                className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0"
                style={{ borderColor: 'var(--c-border)' }}
              >
                <span className="text-cosmos-text">
                  {STEP_LABELS[s.stepKey] ?? s.stepKey.replace(/_/g, ' ')}
                </span>
                <label className="flex items-center gap-2 cursor-pointer text-cosmos-text-3 text-xs">
                  <input
                    type="checkbox"
                    checked={s.completed}
                    disabled={patchStep.isPending}
                    onChange={(e) => patchStep.mutate({ stepKey: s.stepKey, completed: e.target.checked })}
                  />
                  Done
                </label>
              </li>
            ))}
          </ul>
          {patchStep.error && <p className="text-red-400 text-xs mt-2">{errMsg(patchStep.error)}</p>}
        </div>
      )}
    </div>
  )
}

function UsersTab() {
  const qc = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>(INVITE_ROLES[0])
  const [deactivateUser, setDeactivateUser] = useState<UserRow | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)

  const usersQ = useQuery<UsersPage>({
    queryKey: ['users', 'settings'],
    queryFn: () => api.get('/users?page=1&pageSize=100'),
  })

  const invitesQ = useQuery<InviteRow[]>({
    queryKey: ['tenant-invites'],
    queryFn: () => api.get('/tenants/me/invites'),
  })

  const inviteMut = useMutation({
    mutationFn: () =>
      api.post<InviteRow & { inviteUrl?: string }>('/tenants/me/invites', {
        email: inviteEmail.trim(),
        role: inviteRole,
      }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ['tenant-invites'] })
      setInviteOpen(false)
      setInviteEmail('')
      setInviteRole(INVITE_ROLES[0])
      setLinkCopied(false)
      setInviteLink(created?.inviteUrl ?? null)
    },
  })

  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.patch(`/users/${encodeURIComponent(id)}`, { role }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const revokeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/tenants/me/invites/${encodeURIComponent(id)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-invites'] }),
  })

  const deactivateMut = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${encodeURIComponent(id)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] })
      setDeactivateUser(null)
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div>
          <h2 className="text-cosmos-white font-semibold font-display">Team members</h2>
          <p className="text-cosmos-text-3 text-sm mt-1">Deactivate users on this tenant · invite by email</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setInviteOpen(true)}>
          Invite user
        </button>
      </div>

      <div className="cosmos-card overflow-x-auto">
        {usersQ.isLoading ? (
          <div className="skeleton h-32 w-full" />
        ) : usersQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(usersQ.error)}</p>
        ) : (
          <table className="cosmos-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(usersQ.data?.items ?? []).map((u) => (
                <tr key={u.id} className={u.isActive ? '' : 'opacity-50'}>
                  <td>
                    {u.firstName} {u.lastName}
                  </td>
                  <td className="font-mono text-xs">{u.email}</td>
                  <td className="text-sm text-cosmos-text-2">
                    {u.isActive ? (
                      <select
                        className="cosmos-input !py-1 !px-2 !text-xs w-auto"
                        value={u.role}
                        disabled={roleMut.isPending}
                        onChange={(e) => roleMut.mutate({ id: u.id, role: e.target.value })}
                      >
                        {(INVITE_ROLES.includes(u.role as (typeof INVITE_ROLES)[number])
                          ? INVITE_ROLES
                          : [u.role, ...INVITE_ROLES]
                        ).map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      u.role
                    )}
                  </td>
                  <td className="text-sm">{u.isActive ? 'Active' : 'Inactive'}</td>
                  <td className="text-right">
                    {u.isActive && (
                      <button type="button" className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => setDeactivateUser(u)}>
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {roleMut.error ? <p className="text-red-400 text-xs mt-2">{errMsg(roleMut.error)}</p> : null}
      </div>

      {inviteLink ? (
        <div className="cosmos-card" style={{ borderColor: 'var(--c-accent)' }}>
          <h3 className="text-cosmos-white font-semibold font-display mb-2">Invite link created</h3>
          <p className="text-cosmos-text-3 text-sm mb-3">
            An email was sent if delivery is configured. You can also share this link directly — it is shown only
            once and expires in 7 days.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <code className="text-xs font-mono break-all px-3 py-2 rounded-lg" style={{ background: 'var(--c-surface-2)', color: 'var(--c-accent)' }}>
              {inviteLink}
            </code>
            <button
              type="button"
              className="btn-ghost !py-1 !px-3 !text-xs"
              onClick={() => {
                void navigator.clipboard.writeText(inviteLink).then(() => setLinkCopied(true))
              }}
            >
              {linkCopied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="btn-ghost !py-1 !px-3 !text-xs" onClick={() => setInviteLink(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <ChangePasswordCard />

      <div className="cosmos-card">
        <h3 className="text-cosmos-white font-semibold font-display mb-3">Pending invites</h3>
        {invitesQ.isLoading ? (
          <div className="skeleton h-16 w-full" />
        ) : invitesQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(invitesQ.error)}</p>
        ) : (invitesQ.data ?? []).length === 0 ? (
          <p className="text-sm text-cosmos-text-3">No pending invites</p>
        ) : (
          <table className="cosmos-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(invitesQ.data ?? []).map((inv) => (
                <tr key={inv.id}>
                  <td className="font-mono text-xs">{inv.email}</td>
                  <td className="text-sm">{inv.role}</td>
                  <td className="text-sm text-cosmos-text-3">{new Date(inv.expiresAt).toLocaleString()}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-ghost !py-1 !px-2 !text-xs"
                      disabled={revokeMut.isPending}
                      onClick={() => revokeMut.mutate(inv.id)}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CosmosDialogModal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title="Invite user"
        maxWidthClass="max-w-md"
        footer={
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-ghost" onClick={() => setInviteOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!inviteEmail.trim() || inviteMut.isPending}
              onClick={() => inviteMut.mutate()}
            >
              Send invite
            </button>
          </div>
        }
      >
        <label className="text-xs text-cosmos-text-3">Email</label>
        <input className="cosmos-input mb-3 mt-1" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
        <label className="text-xs text-cosmos-text-3">Role</label>
        <select className="cosmos-input mt-1" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
          {INVITE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {inviteMut.error && <p className="text-red-400 text-sm mt-3">{errMsg(inviteMut.error)}</p>}
      </CosmosDialogModal>

      <CosmosDialogModal
        open={!!deactivateUser}
        onOpenChange={(o) => !o && setDeactivateUser(null)}
        title="Deactivate user"
        maxWidthClass="max-w-md"
        footer={
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-ghost" onClick={() => setDeactivateUser(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ background: 'var(--c-danger)' }}
              disabled={deactivateMut.isPending || !deactivateUser}
              onClick={() => deactivateUser && deactivateMut.mutate(deactivateUser.id)}
            >
              Deactivate
            </button>
          </div>
        }
      >
        {deactivateUser && (
          <p className="text-sm text-cosmos-text">
            Deactivate <span className="font-mono">{deactivateUser.email}</span>? They will not be able to sign in.
          </p>
        )}
        {deactivateMut.error && <p className="text-red-400 text-sm mt-3">{errMsg(deactivateMut.error)}</p>}
      </CosmosDialogModal>
    </div>
  )
}

function TaxSettingsCard() {
  const qc = useQueryClient()
  const taxQ = useQuery<{ salesTaxRate: number; salesTaxPercent: number }>({
    queryKey: ['tax-settings'],
    queryFn: () => api.get('/tax/settings'),
  })
  const [percent, setPercent] = useState('')

  useEffect(() => {
    if (taxQ.data) setPercent(String(taxQ.data.salesTaxPercent))
  }, [taxQ.data])

  const saveMut = useMutation({
    mutationFn: (rate: number) => api.patch('/tax/settings', { salesTaxRate: rate }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tax-settings'] }),
  })

  const parsed = Number.parseFloat(percent)
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 50

  return (
    <div className="cosmos-card">
      <h2 className="text-cosmos-white font-semibold font-display mb-1">Sales tax</h2>
      <p className="text-cosmos-text-3 text-sm mb-4">
        Applied to orders, quotes, and POS transactions for this tenant.
      </p>
      {taxQ.isLoading ? (
        <div className="skeleton h-10 w-48" />
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) saveMut.mutate(+(parsed / 100).toFixed(6))
          }}
        >
          <div>
            <label className="text-xs text-cosmos-text-3">Sales tax rate (%)</label>
            <input
              className="cosmos-input mt-1 w-32"
              type="number"
              step="0.01"
              min="0"
              max="50"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={!valid || saveMut.isPending}>
            {saveMut.isPending ? 'Saving…' : 'Save tax rate'}
          </button>
        </form>
      )}
      {saveMut.error && <p className="text-red-400 text-sm mt-2">{errMsg(saveMut.error)}</p>}
      {saveMut.isSuccess && <p className="text-emerald-400 text-sm mt-2">Tax rate updated.</p>}
    </div>
  )
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localErr, setLocalErr] = useState<string | null>(null)

  const changeMut = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      setLocalErr(null)
    },
  })

  return (
    <div className="cosmos-card">
      <h3 className="text-cosmos-white font-semibold font-display mb-1">Change your password</h3>
      <p className="text-cosmos-text-3 text-sm mb-4">
        At least 10 characters with a letter and a number. Changing your password signs out other sessions.
      </p>
      <form
        className="space-y-3 max-w-md"
        onSubmit={(e) => {
          e.preventDefault()
          if (newPassword !== confirm) {
            setLocalErr('New passwords do not match')
            return
          }
          setLocalErr(null)
          changeMut.mutate()
        }}
      >
        <input
          className="cosmos-input"
          type="password"
          placeholder="Current password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        <input
          className="cosmos-input"
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={10}
          autoComplete="new-password"
        />
        <input
          className="cosmos-input"
          type="password"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={10}
          autoComplete="new-password"
        />
        {(localErr || changeMut.error) && (
          <p className="text-red-400 text-sm">{localErr ?? errMsg(changeMut.error)}</p>
        )}
        {changeMut.isSuccess && !localErr ? <p className="text-emerald-400 text-sm">Password updated.</p> : null}
        <button
          type="submit"
          className="btn-primary"
          disabled={!currentPassword || !newPassword || !confirm || changeMut.isPending}
        >
          {changeMut.isPending ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  )
}

function WarehousesTab() {
  const qc = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [line1, setLine1] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [country, setCountry] = useState('US')
  const [isDefault, setIsDefault] = useState(false)

  const warehousesQ = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', 'settings'],
    queryFn: () => api.get('/warehouses'),
  })

  const createMut = useMutation({
    mutationFn: () =>
      api.post('/warehouses', {
        name: name.trim(),
        code: code.trim(),
        address: {
          line1: line1.trim(),
          city: city.trim(),
          state: state.trim(),
          postalCode: postalCode.trim(),
          ...(country.trim() ? { country: country.trim() } : {}),
        },
        isDefault,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['warehouses'] })
      setDrawerOpen(false)
      setName('')
      setCode('')
      setLine1('')
      setCity('')
      setState('')
      setPostalCode('')
      setCountry('US')
      setIsDefault(false)
    },
  })

  const defaultMut = useMutation({
    mutationFn: (id: string) => api.patch(`/warehouses/${encodeURIComponent(id)}`, { isDefault: true }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['warehouses'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-cosmos-white font-semibold font-display">Warehouses</h2>
          <p className="text-cosmos-text-3 text-sm mt-1">POST /warehouses · set default receiving location</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setDrawerOpen(true)}>
          New warehouse
        </button>
      </div>

      <div className="cosmos-card overflow-x-auto">
        {warehousesQ.isLoading ? (
          <div className="skeleton h-24 w-full" />
        ) : warehousesQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(warehousesQ.error)}</p>
        ) : (warehousesQ.data ?? []).length === 0 ? (
          <EmptyState
            icon="🏭"
            title="No warehouses yet"
            description="Add at least one warehouse before receiving inventory, running cycle counts, or filtering pick tasks."
            action={
              <button type="button" className="btn-primary" onClick={() => setDrawerOpen(true)}>
                Add your first warehouse
              </button>
            }
          />
        ) : (
          <table className="cosmos-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Address</th>
                <th>Default</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(warehousesQ.data ?? []).map((w) => {
                const a = w.address as { line1?: string; city?: string; state?: string }
                const addr = [a?.line1, a?.city, a?.state].filter(Boolean).join(', ')
                return (
                  <tr key={w.id}>
                    <td className="font-mono text-xs">{w.code}</td>
                    <td>{w.name}</td>
                    <td className="text-sm text-cosmos-text-2 max-w-[240px] truncate" title={addr}>
                      {addr || '—'}
                    </td>
                    <td>{w.isDefault ? <span className="text-cosmos-accent text-sm">Yes</span> : '—'}</td>
                    <td className="text-right">
                      {!w.isDefault && (
                        <button
                          type="button"
                          className="btn-ghost !py-1 !px-2 !text-xs"
                          disabled={defaultMut.isPending}
                          onClick={() => defaultMut.mutate(w.id)}
                        >
                          Set as default
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <CosmosSheet open={drawerOpen} onOpenChange={setDrawerOpen} title="New warehouse">
        <label className="text-xs text-cosmos-text-3">Name</label>
        <input className="cosmos-input mb-3 mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="text-xs text-cosmos-text-3">Code</label>
        <input className="cosmos-input mb-3 mt-1 font-mono" value={code} onChange={(e) => setCode(e.target.value)} />
        <label className="text-xs text-cosmos-text-3">Address line 1</label>
        <input className="cosmos-input mb-3 mt-1" value={line1} onChange={(e) => setLine1(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-cosmos-text-3">City</label>
            <input className="cosmos-input mt-1" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-cosmos-text-3">State</label>
            <input className="cosmos-input mt-1" value={state} onChange={(e) => setState(e.target.value)} />
          </div>
        </div>
        <label className="text-xs text-cosmos-text-3 mt-3 block">Postal code</label>
        <input className="cosmos-input mb-3 mt-1" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
        <label className="text-xs text-cosmos-text-3">Country</label>
        <input className="cosmos-input mb-3 mt-1" value={country} onChange={(e) => setCountry(e.target.value)} />
        <label className="flex items-center gap-2 cursor-pointer mb-4">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          <span className="text-sm text-cosmos-text">Set as default warehouse</span>
        </label>
        {createMut.error && <p className="text-red-400 text-sm mb-3">{errMsg(createMut.error)}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={() => setDrawerOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!name.trim() || !code.trim() || !line1.trim() || !city.trim() || !state.trim() || !postalCode.trim() || createMut.isPending}
            onClick={() => createMut.mutate()}
          >
            Create
          </button>
        </div>
      </CosmosSheet>
    </div>
  )
}

function IntegrationsTab() {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [rotateOpen, setRotateOpen] = useState(false)
  const [reporterDid, setReporterDid] = useState('')
  const [manufacturerDid, setManufacturerDid] = useState('')
  const [manufacturerName, setManufacturerName] = useState('')
  const [ediEndpoint, setEdiEndpoint] = useState('')
  const [msaEnabled, setMsaEnabled] = useState(true)
  const [autoSubmit, setAutoSubmit] = useState(false)

  const msaQ = useQuery<MsaConfig | null>({
    queryKey: ['msa-config'],
    queryFn: () => api.get('/msa/config'),
  })

  const stripeQ = useQuery<StripeStatus>({
    queryKey: ['stripe-status'],
    queryFn: () => api.get('/payments/stripe/status'),
  })

  const notifProvidersQ = useQuery<NotificationProviderStatus>({
    queryKey: ['notification-providers'],
    queryFn: () => api.get('/notifications/providers/status'),
  })

  const saveMsaMut = useMutation({
    mutationFn: () =>
      api.post('/msa/config', {
        reporterDid: reporterDid.trim(),
        manufacturerDid: manufacturerDid.trim(),
        manufacturerName: manufacturerName.trim(),
        msaEnabled,
        autoSubmit,
        ...(ediEndpoint.trim() ? { ediEndpoint: ediEndpoint.trim() } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['msa-config'] })
      setAddOpen(false)
      setReporterDid('')
      setManufacturerDid('')
      setManufacturerName('')
      setEdiEndpoint('')
      setMsaEnabled(true)
      setAutoSubmit(false)
    },
  })

  const cfg = msaQ.data

  const ediPartnersQ = useQuery<
    Array<{ id: string; code: string; name: string; inboundEnabled: boolean; outboundEnabled: boolean; autoCreateOrders: boolean }>
  >({
    queryKey: ['edi-partners'],
    queryFn: () => api.get('/edi/partners'),
  })

  const [ediCode, setEdiCode] = useState('')
  const [ediName, setEdiName] = useState('')
  const [ediDrawer, setEdiDrawer] = useState(false)

  const createEdiPartner = useMutation({
    mutationFn: () =>
      api.post('/edi/partners', {
        code: ediCode.trim(),
        name: ediName.trim(),
        autoCreateOrders: true,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['edi-partners'] })
      setEdiDrawer(false)
      setEdiCode('')
      setEdiName('')
    },
  })

  const ediDocsQ = useQuery<
    Array<{ id: string; docType: string; direction: string; status: string; controlNumber: string | null; createdAt: string }>
  >({
    queryKey: ['edi-documents'],
    queryFn: () => api.get('/edi/documents?limit=20'),
  })

  return (
    <div className="space-y-6">
      <WebhookManager />

      <div className="cosmos-card">
        <div className="flex flex-wrap justify-between gap-3 mb-4">
          <div>
            <h3 className="text-cosmos-white font-semibold font-display">Trading partner EDI</h3>
            <p className="text-cosmos-text-3 text-sm mt-1">
              Inbound 850 purchase orders, outbound 810 invoices and 856 ship notices (JSON interchange).
            </p>
          </div>
          <button type="button" className="btn-primary !text-sm" onClick={() => setEdiDrawer(true)}>
            Add partner
          </button>
        </div>
        {ediPartnersQ.isLoading ? (
          <div className="skeleton h-16 w-full" />
        ) : (ediPartnersQ.data ?? []).length === 0 ? (
          <p className="text-sm text-cosmos-text-3">No trading partners — add one to receive EDI orders.</p>
        ) : (
          <ul className="space-y-2">
            {(ediPartnersQ.data ?? []).map((p) => (
              <li key={p.id} className="text-sm flex flex-wrap gap-3 items-center" style={{ color: 'var(--c-text-2)' }}>
                <span className="font-mono text-cosmos-accent">{p.code}</span>
                <span className="text-cosmos-white">{p.name}</span>
                <span className="text-xs text-cosmos-text-3">
                  In: {p.inboundEnabled ? 'on' : 'off'} · Out: {p.outboundEnabled ? 'on' : 'off'} · Auto orders:{' '}
                  {p.autoCreateOrders ? 'on' : 'off'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {(ediDocsQ.data ?? []).length > 0 ? (
          <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--c-border)' }}>
            <p className="text-xs uppercase tracking-wider text-cosmos-text-3 mb-2">Recent EDI documents</p>
            <ul className="space-y-1 text-xs font-mono" style={{ color: 'var(--c-text-3)' }}>
              {(ediDocsQ.data ?? []).slice(0, 5).map((d) => (
                <li key={d.id}>
                  {d.docType} {d.direction} · {d.status} · {d.controlNumber ?? d.id.slice(-8)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {ediDrawer ? (
        <CosmosDialogModal open={ediDrawer} onOpenChange={setEdiDrawer} title="New EDI trading partner">
          <label className="block text-xs text-cosmos-text-3 mt-2">Partner code</label>
          <input className="cosmos-input mt-1 w-full" value={ediCode} onChange={(e) => setEdiCode(e.target.value)} placeholder="ACME" />
          <label className="block text-xs text-cosmos-text-3 mt-3">Name</label>
          <input className="cosmos-input mt-1 w-full" value={ediName} onChange={(e) => setEdiName(e.target.value)} placeholder="Acme Retail EDI" />
          <div className="flex gap-2 mt-4 justify-end">
            <button type="button" className="btn-ghost" onClick={() => setEdiDrawer(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!ediCode.trim() || !ediName.trim() || createEdiPartner.isPending}
              onClick={() => createEdiPartner.mutate()}
            >
              Save
            </button>
          </div>
        </CosmosDialogModal>
      ) : null}

      <div>
        <h2 className="text-cosmos-white font-semibold font-display">Other integrations</h2>
        <p className="text-cosmos-text-3 text-sm mt-1">MSA reporting config and Stripe webhook health</p>
      </div>

      <div className="cosmos-card">
        <div className="flex flex-wrap justify-between gap-3 mb-4">
          <h3 className="text-cosmos-white font-semibold font-display">MSA (compliance)</h3>
          <button
            type="button"
            className="btn-primary !text-sm"
            onClick={() => {
              if (msaQ.data) {
                setReporterDid(msaQ.data.reporterDid)
                setMsaEnabled(msaQ.data.msaEnabled)
              } else {
                setReporterDid('')
                setMsaEnabled(true)
              }
              setManufacturerDid('')
              setManufacturerName('')
              setEdiEndpoint('')
              setAutoSubmit(false)
              setAddOpen(true)
            }}
          >
            Add configuration
          </button>
        </div>
        {msaQ.isLoading ? (
          <div className="skeleton h-20 w-full" />
        ) : msaQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(msaQ.error)}</p>
        ) : !cfg ? (
          <p className="text-sm text-cosmos-text-3">No MSA tenant config yet — add reporter and manufacturer DIDs.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-cosmos-text-2">
              Reporter DID: <span className="font-mono text-cosmos-accent">{cfg.reporterDid}</span> · MSA{' '}
              {cfg.msaEnabled ? 'enabled' : 'disabled'}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {cfg.manufacturerDids.map((m) => (
                <div key={m.id} className="rounded-xl p-4 border" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}>
                  <p className="font-mono text-xs text-cosmos-accent break-all">{m.manufacturerDid}</p>
                  <p className="text-cosmos-white font-medium mt-1">{m.manufacturerName}</p>
                  <p className="text-xs text-cosmos-text-3 mt-2">
                    EDI: {m.ediEndpoint || '—'} · Auto-submit: {m.autoSubmit ? 'on' : 'off'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="cosmos-card">
        <h3 className="text-cosmos-white font-semibold font-display mb-3">Notification delivery</h3>
        <p className="text-cosmos-text-3 text-sm mb-4">GET /notifications/providers/status — env-driven SendGrid, Twilio, or webhook</p>
        {notifProvidersQ.isLoading ? (
          <div className="skeleton h-20 w-full" />
        ) : notifProvidersQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(notifProvidersQ.error)}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl p-4 border" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}>
              <p className="text-sm text-cosmos-white font-medium">Email</p>
              <p className="text-xs text-cosmos-text-3 mt-2">
                Provider: <span className="font-mono text-cosmos-accent">{notifProvidersQ.data?.email.provider}</span>
              </p>
              <p className="text-xs text-cosmos-text-3 mt-1">
                Configured:{' '}
                <strong className={notifProvidersQ.data?.email.configured ? 'text-emerald-400' : 'text-amber-400'}>
                  {notifProvidersQ.data?.email.configured ? 'yes' : 'console fallback'}
                </strong>
              </p>
              <p className="text-xs text-cosmos-text-3 mt-1">From: {notifProvidersQ.data?.email.fromEmail}</p>
            </div>
            <div className="rounded-xl p-4 border" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}>
              <p className="text-sm text-cosmos-white font-medium">SMS</p>
              <p className="text-xs text-cosmos-text-3 mt-2">
                Provider: <span className="font-mono text-cosmos-accent">{notifProvidersQ.data?.sms.provider}</span>
              </p>
              <p className="text-xs text-cosmos-text-3 mt-1">
                Configured:{' '}
                <strong className={notifProvidersQ.data?.sms.configured ? 'text-emerald-400' : 'text-amber-400'}>
                  {notifProvidersQ.data?.sms.configured ? 'yes' : 'console fallback'}
                </strong>
              </p>
              <p className="text-xs text-cosmos-text-3 mt-1">
                From: {notifProvidersQ.data?.sms.fromNumberMasked ?? '—'}
              </p>
            </div>
          </div>
        )}
        {notifProvidersQ.data ? (
          <p className="text-xs text-cosmos-text-3 mt-4 whitespace-pre-wrap">{notifProvidersQ.data.setupNote}</p>
        ) : null}
      </div>

      <div className="cosmos-card">
        <div className="flex flex-wrap justify-between gap-3 items-start mb-3">
          <div>
            <h3 className="text-cosmos-white font-semibold font-display">Stripe</h3>
            <p className="text-cosmos-text-3 text-sm mt-1">GET /payments/stripe/status</p>
          </div>
          <button type="button" className="btn-ghost !text-sm" onClick={() => setRotateOpen(true)}>
            Rotate signing secret
          </button>
        </div>
        {stripeQ.isLoading ? (
          <div className="skeleton h-16 w-full" />
        ) : stripeQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(stripeQ.error)}</p>
        ) : (
          <div className="rounded-xl p-4 border" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}>
            <p className="text-sm text-cosmos-text">
              Webhook signing secret:{' '}
              <strong className={stripeQ.data?.webhookSigningSecretConfigured ? 'text-emerald-400' : 'text-amber-400'}>
                {stripeQ.data?.webhookSigningSecretConfigured ? 'configured' : 'not configured'}
              </strong>
            </p>
          </div>
        )}
      </div>

      <CosmosSheet open={addOpen} onOpenChange={setAddOpen} title="Add MSA configuration">
        <p className="text-xs text-cosmos-text-3 mb-3">POST /msa/config — creates or updates tenant MSA row and manufacturer DID.</p>
        <label className="text-xs text-cosmos-text-3">Reporter DID</label>
        <input className="cosmos-input mb-3 mt-1 font-mono text-sm" value={reporterDid} onChange={(e) => setReporterDid(e.target.value)} />
        <label className="text-xs text-cosmos-text-3">Manufacturer DID</label>
        <input className="cosmos-input mb-3 mt-1 font-mono text-sm" value={manufacturerDid} onChange={(e) => setManufacturerDid(e.target.value)} />
        <label className="text-xs text-cosmos-text-3">Manufacturer name</label>
        <input className="cosmos-input mb-3 mt-1" value={manufacturerName} onChange={(e) => setManufacturerName(e.target.value)} />
        <label className="text-xs text-cosmos-text-3">EDI endpoint (optional)</label>
        <input className="cosmos-input mb-3 mt-1 font-mono text-sm" value={ediEndpoint} onChange={(e) => setEdiEndpoint(e.target.value)} />
        <label className="flex items-center gap-2 cursor-pointer mb-2">
          <input type="checkbox" checked={msaEnabled} onChange={(e) => setMsaEnabled(e.target.checked)} />
          <span className="text-sm text-cosmos-text">MSA enabled</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer mb-4">
          <input type="checkbox" checked={autoSubmit} onChange={(e) => setAutoSubmit(e.target.checked)} />
          <span className="text-sm text-cosmos-text">Auto-submit reports</span>
        </label>
        {saveMsaMut.error && <p className="text-red-400 text-sm mb-3">{errMsg(saveMsaMut.error)}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-ghost" onClick={() => setAddOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={
              !reporterDid.trim() || !manufacturerDid.trim() || !manufacturerName.trim() || saveMsaMut.isPending
            }
            onClick={() => saveMsaMut.mutate()}
          >
            Save
          </button>
        </div>
      </CosmosSheet>

      <CosmosDialogModal open={rotateOpen} onOpenChange={setRotateOpen} title="Rotate Stripe webhook secret" maxWidthClass="max-w-lg">
        <p className="text-sm text-cosmos-text whitespace-pre-wrap">
          {stripeQ.data?.rotation ??
            'Create a new signing secret in the Stripe Dashboard for your webhook endpoint, update STRIPE_WEBHOOK_SECRET in your environment, redeploy, then remove the old secret in Stripe.'}
        </p>
      </CosmosDialogModal>
    </div>
  )
}

const PLANS = [
  {
    id: 'STARTER' as const,
    name: 'Starter',
    blurb: 'Core operations for small teams',
  },
  {
    id: 'GROWTH' as const,
    name: 'Growth',
    blurb: 'Scaling workflows and integrations',
  },
  {
    id: 'ENTERPRISE' as const,
    name: 'Enterprise',
    blurb: 'Dedicated support and limits',
  },
]

type BillingStatus = {
  plan: string
  billingStatus: string | null
  billingConfigured: boolean
  pricesConfigured: { growth: boolean; enterprise: boolean }
}

function BillingTab() {
  const qc = useQueryClient()
  const searchParams = useQueryParams()
  const checkoutResult = searchParams.get('checkout')

  const tenant = useQuery<TenantMe>({
    queryKey: ['tenant-me'],
    queryFn: () => api.get('/tenants/me'),
  })

  const billingQ = useQuery<BillingStatus>({
    queryKey: ['billing-status'],
    queryFn: () => api.get('/tenants/me/billing'),
  })

  const upgradeMut = useMutation({
    mutationFn: async (plan: 'STARTER' | 'GROWTH' | 'ENTERPRISE') => {
      if (billingQ.data?.billingConfigured && plan !== 'STARTER') {
        const { url } = await api.post<{ url: string }>('/tenants/me/billing/checkout', { plan })
        window.location.href = url
        return
      }
      return api.post('/tenants/me/upgrade', { plan })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant-me'] })
      void qc.invalidateQueries({ queryKey: ['billing-status'] })
    },
  })

  const portalMut = useMutation({
    mutationFn: () => api.post<{ url: string }>('/tenants/me/billing/portal'),
    onSuccess: (res) => {
      if (res?.url) window.location.href = res.url
    },
  })

  const current = tenant.data?.plan ?? 'STARTER'
  const stripeOn = billingQ.data?.billingConfigured ?? false

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-cosmos-white font-semibold font-display">Billing</h2>
          <p className="text-cosmos-text-3 text-sm mt-1">
            {stripeOn
              ? 'Paid plans are billed through Stripe Checkout. Manage your subscription in the billing portal.'
              : 'Stripe is not configured — plan changes apply immediately (local dev only).'}
          </p>
        </div>
        {stripeOn && billingQ.data?.billingStatus ? (
          <button
            type="button"
            className="btn-ghost !text-sm"
            disabled={portalMut.isPending}
            onClick={() => portalMut.mutate()}
          >
            {portalMut.isPending ? 'Opening…' : 'Manage subscription'}
          </button>
        ) : null}
      </div>

      {checkoutResult === 'success' ? (
        <p className="text-sm text-emerald-400">Checkout complete — your plan will update shortly.</p>
      ) : checkoutResult === 'cancel' ? (
        <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Checkout canceled.</p>
      ) : null}

      <div className="cosmos-card">
        <h3 className="text-cosmos-white font-semibold font-display mb-2">Current plan</h3>
        {tenant.isLoading ? (
          <div className="skeleton h-10 w-48" />
        ) : (
          <>
            <p className="text-2xl font-bold text-cosmos-accent font-display">{current}</p>
            {billingQ.data?.billingStatus ? (
              <p className="text-xs text-cosmos-text-3 mt-2 capitalize">Subscription: {billingQ.data.billingStatus}</p>
            ) : null}
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => {
          const isCurrent = current === p.id
          const paidUnavailable =
            stripeOn &&
            p.id !== 'STARTER' &&
            !billingQ.data?.pricesConfigured[p.id === 'GROWTH' ? 'growth' : 'enterprise']
          return (
            <div key={p.id} className="cosmos-card flex flex-col">
              <h4 className="text-cosmos-white font-semibold font-display">{p.name}</h4>
              <p className="text-sm text-cosmos-text-3 mt-2 flex-1">{p.blurb}</p>
              <button
                type="button"
                className="btn-primary mt-4 w-full"
                disabled={isCurrent || upgradeMut.isPending || paidUnavailable || (stripeOn && p.id === 'STARTER')}
                onClick={() => upgradeMut.mutate(p.id)}
              >
                {isCurrent
                  ? 'Current plan'
                  : stripeOn && p.id !== 'STARTER'
                    ? `Subscribe to ${p.name}`
                    : p.id === 'STARTER'
                      ? 'Free tier'
                      : `Upgrade to ${p.name}`}
              </button>
              {paidUnavailable ? (
                <p className="text-xs text-amber-400 mt-2">Set STRIPE_PRICE_{p.id} in environment</p>
              ) : null}
            </div>
          )
        })}
      </div>
      {(upgradeMut.error || portalMut.error) && (
        <p className="text-red-400 text-sm">{errMsg(upgradeMut.error ?? portalMut.error)}</p>
      )}
    </div>
  )
}

type TenantFeatures = {
  pos?: boolean
  quotes?: boolean
  contractPricing?: boolean
  wavePicking?: boolean
  splitShipments?: boolean
  advancedTax?: boolean
  celestial?: boolean
}

type FeaturesDetail = {
  plan: string
  defaults: TenantFeatures
  overrides: TenantFeatures
  effective: TenantFeatures
}

const FEATURE_META: Array<{ key: keyof TenantFeatures; label: string; blurb: string }> = [
  { key: 'pos', label: 'Point of sale', blurb: 'In-store registers and POS checkout' },
  { key: 'quotes', label: 'Quotes', blurb: 'Buyer quote requests and counter-offers' },
  { key: 'contractPricing', label: 'Contract pricing', blurb: 'Customer-specific price lists and volume tiers' },
  { key: 'wavePicking', label: 'Wave picking', blurb: 'Batch pick waves in warehouse' },
  { key: 'splitShipments', label: 'Split shipments', blurb: 'Multiple packages per order with tracking' },
  { key: 'advancedTax', label: 'Advanced tax', blurb: 'Extended sales tax engine' },
  { key: 'celestial', label: 'Celestial AI', blurb: 'In-app AI assistant for buyers and admin staff' },
]

function buildFeatureOverrides(defaults: TenantFeatures, toggles: TenantFeatures): TenantFeatures {
  const overrides: TenantFeatures = {}
  for (const { key } of FEATURE_META) {
    if (toggles[key] !== defaults[key]) overrides[key] = toggles[key]
  }
  return overrides
}

function FeaturesTab() {
  const qc = useQueryClient()
  const detailQ = useQuery<FeaturesDetail>({
    queryKey: ['tenant-features'],
    queryFn: () => api.get('/features'),
  })
  const [toggles, setToggles] = useState<TenantFeatures>({})

  useEffect(() => {
    if (detailQ.data?.effective) setToggles(detailQ.data.effective)
  }, [detailQ.data])

  const saveMut = useMutation({
    mutationFn: () => {
      const defaults = detailQ.data?.defaults ?? {}
      return api.patch('/tenants/me', {
        settingsPatch: { features: buildFeatureOverrides(defaults, toggles) },
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant-features'] })
    },
  })

  const plan = detailQ.data?.plan ?? '—'
  const overrides = detailQ.data?.overrides ?? {}

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-cosmos-white font-semibold font-display">Feature flags</h2>
        <p className="text-cosmos-text-3 text-sm mt-1">
          Plan defaults for <span className="font-mono text-cosmos-accent">{plan}</span> · overrides saved via PATCH /tenants/me
        </p>
      </div>

      <div className="cosmos-card space-y-4">
        {detailQ.isLoading ? (
          <div className="skeleton h-32 w-full" />
        ) : detailQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(detailQ.error)}</p>
        ) : (
          FEATURE_META.map(({ key, label, blurb }) => {
            const planDefault = detailQ.data?.defaults[key] ?? false
            const overridden = overrides[key] !== undefined
            return (
              <div
                key={key}
                className="flex flex-wrap items-start justify-between gap-3 border-b pb-4 last:border-0 last:pb-0"
                style={{ borderColor: 'var(--c-border)' }}
              >
                <div>
                  <p className="text-cosmos-white font-medium">{label}</p>
                  <p className="text-xs text-cosmos-text-3 mt-1">{blurb}</p>
                  <p className="text-xs text-cosmos-text-3 mt-1">
                    Plan default: {planDefault ? 'On' : 'Off'}
                    {overridden ? <span className="text-cosmos-accent ml-2">· overridden</span> : null}
                  </p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(toggles[key])}
                    onChange={(e) => setToggles((prev) => ({ ...prev, [key]: e.target.checked }))}
                  />
                  <span className="text-sm text-cosmos-text">{toggles[key] ? 'Enabled' : 'Disabled'}</span>
                </label>
              </div>
            )
          })
        )}
        {saveMut.error && <p className="text-red-400 text-sm">{errMsg(saveMut.error)}</p>}
        <button
          type="button"
          className="btn-primary"
          disabled={detailQ.isLoading || saveMut.isPending}
          onClick={() => saveMut.mutate()}
        >
          {saveMut.isPending ? 'Saving…' : 'Save feature overrides'}
        </button>
      </div>
    </div>
  )
}

type AuditRow = {
  id: string
  userId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown> | null
  createdAt: string
}

function AuditTab() {
  const [entityType, setEntityType] = useState('')

  const auditQ = useQuery<AuditRow[]>({
    queryKey: ['audit', entityType],
    queryFn: () => {
      const q = entityType.trim() ? `?entityType=${encodeURIComponent(entityType.trim())}&limit=100` : '?limit=100'
      return api.get(`/audit${q}`)
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-cosmos-white font-semibold font-display">Audit log</h2>
        <p className="text-cosmos-text-3 text-sm mt-1">Recent platform events for compliance and troubleshooting.</p>
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-cosmos-text-3">Filter by entity type</label>
          <select className="cosmos-input mt-1 w-48" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">All types</option>
            <option value="Order">Order</option>
            <option value="Invoice">Invoice</option>
            <option value="Payment">Payment</option>
            <option value="User">User</option>
          </select>
        </div>
      </div>
      <div className="cosmos-card overflow-x-auto">
        {auditQ.isLoading ? (
          <div className="skeleton h-32 w-full" />
        ) : auditQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(auditQ.error)}</p>
        ) : (auditQ.data ?? []).length === 0 ? (
          <EmptyState icon="📋" title="No audit events" description="Actions like order shipped and payments appear here." />
        ) : (
          <table className="cosmos-table text-sm">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Entity</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {(auditQ.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td className="text-cosmos-text-3 whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="font-mono text-xs">{row.action}</td>
                  <td>
                    <span className="text-cosmos-text-2">{row.entityType}</span>
                    {row.entityId ? (
                      <span className="font-mono text-xs text-cosmos-text-3 ml-1">…{row.entityId.slice(-10)}</span>
                    ) : null}
                  </td>
                  <td className="font-mono text-xs text-cosmos-text-3">{row.userId?.slice(-8) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
