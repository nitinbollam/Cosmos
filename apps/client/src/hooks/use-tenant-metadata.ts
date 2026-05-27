import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { readMetadata, type TenantMe, type TenantMetadata } from '@/lib/tenant-metadata'

export function useTenantMe() {
  return useQuery({
    queryKey: ['tenant', 'me'],
    queryFn: () => api.get<TenantMe>('/tenants/me'),
  })
}

export function useTenantMetadataPatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (metadataPatch: TenantMetadata) =>
      api.patch<TenantMe>('/tenants/me', { metadataPatch }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant', 'me'] }),
  })
}

export function useMetadataList(key: keyof TenantMetadata, subKey: string) {
  const tenantQ = useTenantMe()
  const patch = useTenantMetadataPatch()
  const meta = readMetadata(tenantQ.data)
  const section = (meta[key] ?? {}) as Record<string, unknown>
  const items = (section[subKey] as string[] | undefined) ?? []

  const save = async (next: string[]) => {
    await patch.mutateAsync({ [key]: { ...section, [subKey]: next } } as TenantMetadata)
  }

  return { items, save, isLoading: tenantQ.isLoading, isSaving: patch.isPending, error: patch.error }
}

export function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}
