import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { PlerosDialogModal } from '@/components/pleros/radix-overlays'
import { UserRow, UsersPage, InviteRow, INVITE_ROLES, errMsg } from '../types'

const PERMISSION_MODULES = [
  { id: 'inventory', name: 'Inventory & Catalog', description: 'SKUs, stock levels, stock alerts, lots' },
  { id: 'orders', name: 'Orders & Drop-Ship', description: 'Sales orders, fulfillment, payments, shipments' },
  { id: 'purchasing', name: 'Purchasing & Suppliers', description: 'Purchase orders, receiving, vendor management' },
  { id: 'wms', name: 'WMS & Warehouse Ops', description: 'Pick waves, putaway, cycle counts, labor tracking' },
  { id: 'crm', name: 'CRM & Customers', description: 'Customers, leads, activity timeline, customer pricing' },
  { id: 'quotes', name: 'Quotes & Counter-Offers', description: 'Quote management, approval workflows' },
  { id: 'dispatch', name: 'Dispatch & Routing', description: 'Delivery routes, driver assignment, proof of delivery' },
  { id: 'finance', name: 'Finance & Accounting', description: 'Invoices, AP bills, journal entries, chart of accounts' },
  { id: 'compliance', name: 'Compliance & Regulatory', description: 'MSA reporting, age verification, tobacco licenses' },
  { id: 'reports', name: 'Reports & Analytics', description: 'Financial reports, report builder, KPI snapshots' },
  { id: 'notifications', name: 'Notifications & Alerts', description: 'Email/SMS logs, alerts, template dispatch' },
  { id: 'pos', name: 'Point of Sale', description: 'POS registers, counter sales, receipts' },
  { id: 'edi', name: 'EDI Documents', description: '850/810/856 electronic data interchange' },
  { id: 'audit', name: 'Audit Logs', description: 'System compliance and security audit trail' },
  { id: 'settings', name: 'Tenant Settings', description: 'Company profile, team management, webhooks' },
  { id: 'celestial', name: 'Celestial AI Copilot', description: 'AI assistant and conversational workflows' },
] as const

export function UsersTab() {
  const qc = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>(INVITE_ROLES[0])
  const [deactivateUser, setDeactivateUser] = useState<UserRow | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [permsUser, setPermsUser] = useState<UserRow | null>(null)
  const [selectedPerms, setSelectedPerms] = useState<string[]>([])

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

  const permsMut = useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: string[] }) =>
      api.patch(`/users/${encodeURIComponent(id)}`, { permissions }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] })
      setPermsUser(null)
    },
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

  const openPermsModal = (u: UserRow) => {
    setPermsUser(u)
    setSelectedPerms(u.permissions ?? [])
  }

  const togglePerm = (perm: string) => {
    setSelectedPerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
    )
  }

  const toggleModuleWildcard = (modId: string) => {
    const wild = `${modId}.*`
    const read = `${modId}.read`
    const write = `${modId}.write`
    setSelectedPerms((prev) => {
      if (prev.includes(wild)) {
        return prev.filter((p) => p !== wild)
      }
      return [...prev.filter((p) => p !== read && p !== write), wild]
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-3 items-start">
        <div>
          <h2 className="text-pleros-white font-semibold font-display">Team members</h2>
          <p className="text-pleros-text-3 text-sm mt-1">Manage users, roles, and granular module permissions</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setInviteOpen(true)}>
          Invite user
        </button>
      </div>

      <div className="pleros-card overflow-x-auto">
        {usersQ.isLoading ? (
          <div className="skeleton h-32 w-full" />
        ) : usersQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(usersQ.error)}</p>
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Permissions</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(usersQ.data?.items ?? []).map((u) => {
                const customPermCount = u.permissions?.length ?? 0
                return (
                  <tr key={u.id} className={u.isActive ? '' : 'opacity-50'}>
                    <td>
                      {u.firstName} {u.lastName}
                    </td>
                    <td className="font-mono text-xs">{u.email}</td>
                    <td className="text-sm text-pleros-text-2">
                      {u.isActive ? (
                        <select
                          className="pleros-input !py-1 !px-2 !text-xs w-auto"
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
                    <td className="text-xs">
                      {u.role === 'SUPER_ADMIN' || u.role === 'TENANT_ADMIN' ? (
                        <span className="text-pleros-text-3 font-mono">Full Access (*)</span>
                      ) : customPermCount > 0 ? (
                        <span className="text-emerald-400 font-medium">
                          {customPermCount} custom {customPermCount === 1 ? 'rule' : 'rules'}
                        </span>
                      ) : (
                        <span className="text-pleros-text-3">Role default</span>
                      )}
                    </td>
                    <td className="text-sm">{u.isActive ? 'Active' : 'Inactive'}</td>
                    <td className="text-right">
                      {u.isActive && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="btn-ghost !py-1 !px-2 !text-xs text-pleros-text-2 hover:text-pleros-white"
                            onClick={() => openPermsModal(u)}
                          >
                            Permissions
                          </button>
                          <button
                            type="button"
                            className="btn-ghost !py-1 !px-2 !text-xs text-red-400 hover:text-red-300"
                            onClick={() => setDeactivateUser(u)}
                          >
                            Deactivate
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {roleMut.error ? <p className="text-red-400 text-xs mt-2">{errMsg(roleMut.error)}</p> : null}
      </div>

      {inviteLink ? (
        <div className="pleros-card" style={{ borderColor: 'var(--c-accent)' }}>
          <h3 className="text-pleros-white font-semibold font-display mb-2">Invite link created</h3>
          <p className="text-pleros-text-3 text-sm mb-3">
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

      <div className="pleros-card">
        <h3 className="text-pleros-white font-semibold font-display mb-3">Pending invites</h3>
        {invitesQ.isLoading ? (
          <div className="skeleton h-16 w-full" />
        ) : invitesQ.isError ? (
          <p className="text-sm text-red-400">{errMsg(invitesQ.error)}</p>
        ) : (invitesQ.data ?? []).length === 0 ? (
          <p className="text-sm text-pleros-text-3">No pending invites</p>
        ) : (
          <table className="pleros-table">
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
                  <td className="text-sm text-pleros-text-3">{new Date(inv.expiresAt).toLocaleString()}</td>
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

      <PlerosDialogModal
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
        <label className="text-xs text-pleros-text-3">Email</label>
        <input className="pleros-input mb-3 mt-1" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
        <label className="text-xs text-pleros-text-3">Role</label>
        <select className="pleros-input mt-1" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
          {INVITE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {inviteMut.error && <p className="text-red-400 text-sm mt-3">{errMsg(inviteMut.error)}</p>}
      </PlerosDialogModal>

      <PlerosDialogModal
        open={!!permsUser}
        onOpenChange={(o) => !o && setPermsUser(null)}
        title={permsUser ? `Permissions — ${permsUser.firstName} ${permsUser.lastName}` : 'Permissions'}
        maxWidthClass="max-w-3xl"
        footer={
          <div className="flex gap-2 justify-between items-center w-full">
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost !py-1 !px-2 !text-xs"
                onClick={() => setSelectedPerms(['*'])}
              >
                Grant All (*)
              </button>
              <button
                type="button"
                className="btn-ghost !py-1 !px-2 !text-xs"
                onClick={() => setSelectedPerms([])}
              >
                Reset to Default
              </button>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={() => setPermsUser(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={permsMut.isPending || !permsUser}
                onClick={() => permsUser && permsMut.mutate({ id: permsUser.id, permissions: selectedPerms })}
              >
                {permsMut.isPending ? 'Saving...' : 'Save Permissions'}
              </button>
            </div>
          </div>
        }
      >
        {permsUser && (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}>
              <div>
                <p className="text-sm font-medium text-pleros-white">
                  User: <span className="font-mono text-xs">{permsUser.email}</span>
                </p>
                <p className="text-xs text-pleros-text-3 mt-0.5">
                  Base Role: <span className="font-semibold text-pleros-text">{permsUser.role}</span>
                </p>
              </div>
              {selectedPerms.includes('*') && (
                <span className="px-2 py-1 text-xs font-mono rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Full System Wildcard (*)
                </span>
              )}
            </div>

            {permsUser.role === 'SUPER_ADMIN' || permsUser.role === 'TENANT_ADMIN' ? (
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300">
                This user is an administrator (<span className="font-mono">{permsUser.role}</span>) and intrinsically has full system access to all modules. Custom permissions are optional overrides.
              </div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {PERMISSION_MODULES.map((mod) => {
                const hasWild = selectedPerms.includes('*') || selectedPerms.includes(`${mod.id}.*`)
                const hasRead = hasWild || selectedPerms.includes(`${mod.id}.read`)
                const hasWrite = hasWild || selectedPerms.includes(`${mod.id}.write`)

                return (
                  <div
                    key={mod.id}
                    className="p-3 rounded-lg border flex flex-col justify-between gap-2"
                    style={{
                      borderColor: hasWild || (hasRead && hasWrite) ? 'var(--c-accent)' : 'var(--c-border)',
                      background: 'var(--c-surface-1)',
                    }}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-pleros-white">{mod.name}</span>
                        <button
                          type="button"
                          className="text-[10px] px-1.5 py-0.5 rounded border text-pleros-text-3 hover:text-pleros-white"
                          style={{ borderColor: 'var(--c-border)' }}
                          onClick={() => toggleModuleWildcard(mod.id)}
                        >
                          {hasWild ? 'Custom' : 'All (*)'}
                        </button>
                      </div>
                      <p className="text-[11px] text-pleros-text-3 mt-0.5">{mod.description}</p>
                    </div>

                    <div className="flex items-center gap-4 pt-2 border-t text-xs" style={{ borderColor: 'var(--c-border)' }}>
                      <label className="flex items-center gap-1.5 cursor-pointer text-pleros-text">
                        <input
                          type="checkbox"
                          checked={hasRead}
                          disabled={selectedPerms.includes('*') || selectedPerms.includes(`${mod.id}.*`)}
                          onChange={() => togglePerm(`${mod.id}.read`)}
                        />
                        Read
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-pleros-text">
                        <input
                          type="checkbox"
                          checked={hasWrite}
                          disabled={selectedPerms.includes('*') || selectedPerms.includes(`${mod.id}.*`)}
                          onChange={() => togglePerm(`${mod.id}.write`)}
                        />
                        Write / Action
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
            {permsMut.error && <p className="text-red-400 text-sm mt-3">{errMsg(permsMut.error)}</p>}
          </div>
        )}
      </PlerosDialogModal>

      <PlerosDialogModal
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
          <p className="text-sm text-pleros-text">
            Deactivate <span className="font-mono">{deactivateUser.email}</span>? They will not be able to sign in.
          </p>
        )}
        {deactivateMut.error && <p className="text-red-400 text-sm mt-3">{errMsg(deactivateMut.error)}</p>}
      </PlerosDialogModal>
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
    <div className="pleros-card">
      <h3 className="text-pleros-white font-semibold font-display mb-1">Change your password</h3>
      <p className="text-pleros-text-3 text-sm mb-4">
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
          className="pleros-input"
          type="password"
          placeholder="Current password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        <input
          className="pleros-input"
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={10}
          autoComplete="new-password"
        />
        <input
          className="pleros-input"
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
