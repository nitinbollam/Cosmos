import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { EmptyState } from '@/components/cosmos/empty-state'
import { CosmosSheet } from '@/components/cosmos/radix-overlays'
import { api } from '@/lib/api-admin'
import { errMsg } from '@/hooks/use-tenant-metadata'

type UserRow = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  isActive: boolean
  lastLoginAt?: string | null
}

type UsersPage = { items: UserRow[]; total: number }

export default function GeneralUsersPage() {
  const qc = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('STAFF')

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<UsersPage>('/users?page=1&pageSize=100'),
  })

  const invite = useMutation({
    mutationFn: () => api.post('/tenants/me/invites', { email, role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant', 'me'] })
      setInviteOpen(false)
      setEmail('')
    },
  })

  const deactivate = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  })

  return (
    <AdminPageShell
      title="User"
      section="General"
      description="Manage team members and send invites."
      actions={
        <button type="button" className="btn-primary" onClick={() => setInviteOpen(true)}>
          Invite user
        </button>
      }
    >
      {users.isLoading ? (
        <p style={{ color: 'var(--c-text-2)' }}>Loading users…</p>
      ) : (users.data?.items.length ?? 0) === 0 ? (
        <EmptyState icon="👤" title="No users" description="Invite your first team member." />
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--c-border-card)' }}>
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--c-surface-2)' }}>
              <tr>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Role</th>
                <th className="text-left p-3">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {users.data?.items.map((u) => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--c-border-card)' }}>
                  <td className="p-3">{u.firstName} {u.lastName}</td>
                  <td className="p-3">{u.email}</td>
                  <td className="p-3">{u.role}</td>
                  <td className="p-3">{u.isActive ? 'Active' : 'Inactive'}</td>
                  <td className="p-3 text-right">
                    {u.isActive ? (
                      <button type="button" className="btn-ghost text-sm" onClick={() => deactivate.mutate(u.id)}>
                        Deactivate
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CosmosSheet open={inviteOpen} onOpenChange={setInviteOpen} title="Invite user">
        <form
          className="space-y-4 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            invite.mutate()
          }}
        >
          <input className="cosmos-input w-full" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <select className="cosmos-input w-full" value={role} onChange={(e) => setRole(e.target.value)}>
            {['STAFF', 'VIEWER', 'MANAGER', 'WAREHOUSE_STAFF', 'SALES_REP', 'DRIVER', 'ACCOUNTANT', 'TENANT_ADMIN'].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          {invite.error ? <p className="text-sm" style={{ color: 'var(--c-danger)' }}>{errMsg(invite.error)}</p> : null}
          <button type="submit" className="btn-primary w-full" disabled={invite.isPending}>Send invite</button>
        </form>
      </CosmosSheet>
    </AdminPageShell>
  )
}
