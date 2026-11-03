import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { hasClientPermission, type Viewer } from '@/lib/requisitions'

/** The signed-in user, from the same ['auth-me'] query the sidebar uses (no extra request). */
export function useViewer(): { viewer: Viewer | undefined; loading: boolean } {
  const q = useQuery({ queryKey: ['auth-me'], queryFn: () => api.get<Viewer>('/auth/me') })
  return { viewer: q.data, loading: q.isLoading }
}

/**
 * Display names for user ids, when the viewer may list users (managers and admins can). Falls back to the id, and to
 * "You" for the viewer.
 */
export function useUserNames(viewer: Viewer | undefined): (userId: string | null | undefined) => string {
  const allowed = hasClientPermission(viewer, 'users.read')
  const q = useQuery({
    queryKey: ['users', 'names'],
    queryFn: () =>
      api.get<{ items: Array<{ id: string; firstName?: string | null; lastName?: string | null; email: string }> }>('/users?page=1&pageSize=200'),
    enabled: allowed,
    retry: false,
    staleTime: 5 * 60_000,
  })
  const names = new Map((q.data?.items ?? []).map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email]))
  return (userId) => {
    if (!userId) return '—'
    if (userId === viewer?.userId) return 'You'
    return names.get(userId) ?? userId
  }
}
