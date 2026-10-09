import { useId, useState } from 'react'
import { COMMON_FAILURE_REASONS, MAX_FAILURE_REASON_LENGTH } from './failure-reasons'

type FailStopFormProps = {
  /** Records the failure. Resolve on success; reject to keep the form open (the caller shows the error). */
  onSubmit: (reason: string) => Promise<unknown>
  onCancel: () => void
}

/**
 * Staff form for marking a stop failed, with a required reason.
 *
 * An in-page form rather than window.prompt, which some in-app browsers and PWA
 * wrappers block, leaving the Failed button doing nothing.
 */
export function FailStopForm({ onSubmit, onCancel }: FailStopFormProps) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const fieldId = useId()

  async function submit() {
    const trimmed = reason.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await onSubmit(trimmed)
    } catch {
      // The caller renders the error; keep the form open so the reason isn't lost.
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
      <label htmlFor={fieldId} className="block text-xs font-semibold text-pleros-text">
        Why couldn't this stop be delivered?
      </label>
      <div className="flex flex-wrap gap-1.5">
        {COMMON_FAILURE_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={reason === r}
            disabled={saving}
            onClick={() => setReason(r)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              reason === r
                ? 'border-red-400/60 bg-red-500/15 text-red-300'
                : 'border-pleros-border text-pleros-muted hover:text-pleros-text'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <textarea
        id={fieldId}
        className="w-full rounded-lg bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text min-h-[60px] focus:outline-none focus:border-pleros-primary"
        placeholder="Reason (required)"
        value={reason}
        maxLength={MAX_FAILURE_REASON_LENGTH}
        disabled={saving}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving || !reason.trim()}
          onClick={() => void submit()}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : 'Mark failed'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-lg border border-pleros-border text-pleros-text hover:bg-pleros-surface-2 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
