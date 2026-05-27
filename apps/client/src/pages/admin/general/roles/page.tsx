import { useQuery } from '@tanstack/react-query'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { api } from '@/lib/api-admin'

const ROLES = ['STAFF', 'VIEWER', 'MANAGER', 'WAREHOUSE_STAFF', 'SALES_REP', 'DRIVER', 'ACCOUNTANT', 'TENANT_ADMIN'] as const

type UserRow = { id: string; email: string; firstName: string; lastName: string; role: string; isActive: boolean }

export default function GeneralRolesPage() {
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ items: UserRow[] }>('/users?page=1&pageSize=200'),
  })

  const byRole = ROLES.map((role) => ({
    role,
    users: (users.data?.items ?? []).filter((u) => u.role === role && u.isActive),
  }))

  return (
    <AdminPageShell title="Role" section="General" description="Roles assigned to active users. Invite users with a role from the User screen.">
      <div className="grid gap-4 md:grid-cols-2">
        {byRole.map(({ role, users: list }) => (
          <div key={role} className="rounded-xl p-4" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }}>
            <h2 className="font-semibold mb-2" style={{ color: 'var(--c-heading)' }}>{role}</h2>
            <p className="text-sm mb-3" style={{ color: 'var(--c-text-2)' }}>{list.length} active user(s)</p>
            <ul className="text-sm space-y-1" style={{ color: 'var(--c-text)' }}>
              {list.length === 0 ? <li className="opacity-60">No users</li> : list.map((u) => <li key={u.id}>{u.firstName} {u.lastName} · {u.email}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </AdminPageShell>
  )
}
