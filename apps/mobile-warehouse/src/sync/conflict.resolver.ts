import type { SyncConflictResolver } from '@nozbe/watermelondb/sync'
import type { DirtyRaw } from '@nozbe/watermelondb/RawRecord'
import type { TableName } from '@nozbe/watermelondb'

/** Prefer newer row by numeric/string timestamps on pull (Watermelon sync hook). */
export const resolveByUpdatedAt: SyncConflictResolver = (
  _table: TableName<any>,
  local: DirtyRaw,
  remote: DirtyRaw,
  resolved: DirtyRaw,
): DirtyRaw => {
  const localTs = Number(local._changed ?? local.updated_at ?? local.updatedAt ?? 0)
  const remoteTs = Number(remote.updated_at ?? remote.updatedAt ?? 0)
  const winner =
    Number.isFinite(localTs) && Number.isFinite(remoteTs) && remoteTs >= localTs ? remote : local
  return { ...resolved, ...winner }
}
