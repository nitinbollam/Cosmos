import { useState } from 'react'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { EmptyState } from '@/components/cosmos/empty-state'
import { errMsg } from '@/hooks/use-tenant-metadata'

export function MetadataListManager({
  title,
  section,
  description,
  itemLabel,
  items,
  onSave,
  isLoading,
  isSaving,
}: {
  title: string
  section: string
  description: string
  itemLabel: string
  items: string[]
  onSave: (items: string[]) => Promise<void>
  isLoading?: boolean
  isSaving?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function addItem(e: React.FormEvent) {
    e.preventDefault()
    const value = draft.trim()
    if (!value) return
    if (items.some((x) => x.toLowerCase() === value.toLowerCase())) {
      setError(`${itemLabel} already exists`)
      return
    }
    setError(null)
    try {
      await onSave([...items, value])
      setDraft('')
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function removeItem(name: string) {
    setError(null)
    try {
      await onSave(items.filter((x) => x !== name))
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <AdminPageShell title={title} section={section} description={description}>
      <form onSubmit={addItem} className="flex flex-wrap gap-2">
        <input
          className="cosmos-input flex-1 min-w-[200px]"
          placeholder={`New ${itemLabel.toLowerCase()}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={isSaving}>
          Add {itemLabel}
        </button>
      </form>
      {error ? <p className="text-sm font-medium" style={{ color: 'var(--c-danger)' }}>{error}</p> : null}
      {isLoading ? (
        <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState icon="📋" title={`No ${itemLabel.toLowerCase()}s yet`} description={`Add your first ${itemLabel.toLowerCase()} above.`} />
      ) : (
        <ul className="space-y-2">
          {items.map((name) => (
            <li
              key={name}
              className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
              style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }}
            >
              <span className="font-medium" style={{ color: 'var(--c-heading)' }}>{name}</span>
              <button type="button" className="btn-ghost text-sm" disabled={isSaving} onClick={() => void removeItem(name)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </AdminPageShell>
  )
}
