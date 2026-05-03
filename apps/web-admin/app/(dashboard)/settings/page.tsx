'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'

type TenantMe = {
  id: string
  slug: string
  displayName: string
  plan: string
  timeZone: string
  billingEmail?: string | null
  suspended: boolean
  onboardingSteps?: Array<{ stepKey: string; completed: boolean }>
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

const STEP_LABELS: Record<string, string> = {
  ORG_PROFILE: 'Organization profile',
  BILLING_CONTACT: 'Billing contact',
  FIRST_WAREHOUSE: 'First warehouse',
  COMPLIANCE_ACK: 'Compliance acknowledgement',
}

export default function SettingsPage() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [timeZone, setTimeZone] = useState('')

  const tenant = useQuery<TenantMe>({
    queryKey: ['tenant-me'],
    queryFn: () => api.get('/tenants/me'),
  })

  useEffect(() => {
    const t = tenant.data
    if (!t || editing) return
    setDisplayName(t.displayName)
    setBillingEmail(t.billingEmail ?? '')
    setTimeZone(t.timeZone)
  }, [tenant.data, editing])

  const patch = useMutation({
    mutationFn: (body: { displayName: string; billingEmail?: string | null; timeZone: string }) =>
      api.patch('/tenants/me', body),
    onSuccess: () => {
      setEditing(false)
      void qc.invalidateQueries({ queryKey: ['tenant-me'] })
    },
  })

  const patchStep = useMutation({
    mutationFn: ({ stepKey, completed }: { stepKey: string; completed: boolean }) =>
      api.patch(`/tenants/me/onboarding-steps/${encodeURIComponent(stepKey)}`, { completed }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-me'] }),
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-cosmos-white">Settings</h1>
        <p className="text-cosmos-muted text-sm mt-1">
          Tenant profile from <span className="font-mono">tenant-service</span>.
        </p>
      </div>

      <Card>
        <CardTitle>Organization</CardTitle>
        {tenant.isLoading ? (
          <p className="mt-4 text-cosmos-muted text-sm">Loading…</p>
        ) : tenant.error || !tenant.data ? (
          <p className="mt-4 text-red-400 text-sm">Could not load tenant.</p>
        ) : (
          <>
            <div className="mt-4 flex justify-end">
              {!editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="h-9 px-4 rounded-md border border-cosmos-border text-cosmos-text text-sm"
                >
                  Edit profile
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false)
                      const t = tenant.data
                      if (t) {
                        setDisplayName(t.displayName)
                        setBillingEmail(t.billingEmail ?? '')
                        setTimeZone(t.timeZone)
                      }
                    }}
                    className="h-9 px-4 rounded-md border border-cosmos-border text-cosmos-text text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!displayName.trim() || patch.isPending}
                    onClick={() =>
                      patch.mutate({
                        displayName: displayName.trim(),
                        billingEmail: billingEmail.trim() ? billingEmail.trim() : null,
                        timeZone: timeZone.trim() || tenant.data.timeZone,
                      })
                    }
                    className="h-9 px-4 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
                  >
                    {patch.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            {!editing ? (
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-cosmos-muted">Display name</dt>
                  <dd className="text-cosmos-white font-medium">{tenant.data.displayName}</dd>
                </div>
                <div>
                  <dt className="text-cosmos-muted">Slug</dt>
                  <dd className="font-mono text-cosmos-text">{tenant.data.slug}</dd>
                </div>
                <div>
                  <dt className="text-cosmos-muted">Plan</dt>
                  <dd className="text-cosmos-text">{tenant.data.plan}</dd>
                </div>
                <div>
                  <dt className="text-cosmos-muted">Time zone</dt>
                  <dd className="text-cosmos-text">{tenant.data.timeZone}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-cosmos-muted">Billing email</dt>
                  <dd className="text-cosmos-text">{tenant.data.billingEmail ?? '—'}</dd>
                </div>
                {tenant.data.suspended && (
                  <div className="sm:col-span-2">
                    <p className="text-amber-400 text-sm">This tenant is suspended.</p>
                  </div>
                )}
              </dl>
            ) : (
              <div className="mt-4 grid gap-3 max-w-xl">
                <div>
                  <label className="text-xs text-cosmos-muted">Display name</label>
                  <input
                    className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-cosmos-muted">Billing email</label>
                  <input
                    className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
                    type="email"
                    value={billingEmail}
                    onChange={(e) => setBillingEmail(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="text-xs text-cosmos-muted">Time zone</label>
                  <input
                    className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
                    value={timeZone}
                    onChange={(e) => setTimeZone(e.target.value)}
                    placeholder="e.g. America/New_York"
                  />
                </div>
              </div>
            )}
            {patch.error && <p className="text-red-400 text-xs mt-3">{errMsg(patch.error)}</p>}
          </>
        )}
      </Card>

      {tenant.data?.onboardingSteps && tenant.data.onboardingSteps.length > 0 && (
        <Card>
          <CardTitle>Onboarding</CardTitle>
          <p className="text-xs text-cosmos-muted mt-1">Toggle steps your organization has finished.</p>
          <ul className="mt-4 space-y-2 text-sm">
            {tenant.data.onboardingSteps.map((s) => (
              <li
                key={s.stepKey}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-cosmos-border/50 pb-3"
              >
                <span className="text-cosmos-text">
                  {STEP_LABELS[s.stepKey] ?? s.stepKey.replace(/_/g, ' ')}
                </span>
                <label className="flex items-center gap-2 cursor-pointer text-cosmos-muted text-xs">
                  <input
                    type="checkbox"
                    checked={s.completed}
                    disabled={patchStep.isPending}
                    onChange={(e) =>
                      patchStep.mutate({ stepKey: s.stepKey, completed: e.target.checked })
                    }
                  />
                  Done
                </label>
              </li>
            ))}
          </ul>
          {patchStep.error && (
            <p className="text-red-400 text-xs mt-2">{errMsg(patchStep.error)}</p>
          )}
        </Card>
      )}
    </div>
  )
}
