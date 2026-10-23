import type { TenantChoice } from '@/lib/login-flow'

/**
 * Shown after the password was accepted for more than one company. Picking a company finishes the
 * sign-in; "Use a different account" goes back to the form without signing anyone in.
 */
export function TenantPicker(props: {
  email: string
  tenants: TenantChoice[]
  busy: boolean
  error: string | null
  onPick: (tenantId: string) => void
  onBack: () => void
}) {
  return (
    <div className="space-y-3" role="group" aria-label="Choose a company">
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--c-heading)' }}>
          Which company?
        </p>
        <p className="text-xs" style={{ color: 'var(--c-text-3)', marginTop: 4 }}>
          {props.email} has an account with more than one company.
        </p>
      </div>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {props.tenants.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className="btn-ghost w-full"
              style={{ textAlign: 'left' }}
              disabled={props.busy}
              onClick={() => props.onPick(t.id)}
            >
              <span style={{ fontWeight: 600 }}>{t.name}</span>
              <span style={{ display: 'block', fontSize: 12, opacity: 0.65 }}>{t.slug}</span>
            </button>
          </li>
        ))}
      </ul>
      {props.error ? (
        <p className="text-sm font-medium" style={{ color: 'var(--c-danger)' }}>
          {props.error}
        </p>
      ) : null}
      <button
        type="button"
        className="btn-ghost w-full"
        disabled={props.busy}
        onClick={props.onBack}
      >
        Use a different account
      </button>
    </div>
  )
}
