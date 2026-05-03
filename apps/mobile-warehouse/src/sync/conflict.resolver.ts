/**
 * Minimal conflict resolution for offline warehouse sync.
 * WatermelonDB sync delegates conflict handling to the app — use this when
 * merging server rows with local drafts (extend when you add multi-field merges).
 */
export function resolveByUpdatedAt<T extends { updated_at?: string | null }>(
  local: T,
  remote: T,
): T {
  const lt = local.updated_at ? Date.parse(local.updated_at) : 0
  const rt = remote.updated_at ? Date.parse(remote.updated_at) : 0
  if (Number.isFinite(lt) && Number.isFinite(rt)) {
    return rt >= lt ? remote : local
  }
  return remote
}
