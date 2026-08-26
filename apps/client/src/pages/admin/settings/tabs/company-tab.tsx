import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { TenantMe, STEP_LABELS, errMsg } from '../types'

export function CompanyTab() {
  const qc = useQueryClient()
  const tenant = useQuery<TenantMe>({
    queryKey: ['tenant-me'],
    queryFn: () => api.get('/tenants/me'),
  })
  const [displayName, setDisplayName] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [timeZone, setTimeZone] = useState('')
  const [industry, setIndustry] = useState('GENERAL_WHOLESALE')

  useEffect(() => {
    const t = tenant.data
    if (!t) return
    setDisplayName(t.displayName)
    setBillingEmail(t.billingEmail ?? '')
    setTimeZone(t.timeZone)
    setIndustry(t.industry ?? 'GENERAL_WHOLESALE')
  }, [tenant.data])

  const patch = useMutation({
    mutationFn: (body: {
      displayName: string
      billingEmail?: string | null
      timeZone: string
      industry: string
    }) => api.patch('/tenants/me', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-me'] }),
  })

  const patchStep = useMutation({
    mutationFn: ({ stepKey, completed }: { stepKey: string; completed: boolean }) =>
      api.patch(`/tenants/me/onboarding-steps/${encodeURIComponent(stepKey)}`, { completed }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-me'] }),
  })

  return (
    <div className="space-y-6">
      <div className="pleros-card">
        <h2 className="text-pleros-white font-semibold font-display mb-1">Company profile</h2>
        <p className="text-pleros-text-3 text-sm mb-4">Organization name, billing contact, and timezone for your tenant.</p>
        {tenant.isLoading ? (
          <div className="skeleton h-24 w-full" />
        ) : tenant.error || !tenant.data ? (
          <p className="text-sm" style={{ color: 'var(--c-danger)' }}>
            Could not load tenant.
          </p>
        ) : (
          <form
            className="space-y-4 max-w-xl"
            onSubmit={(e) => {
              e.preventDefault()
              patch.mutate({
                displayName: displayName.trim(),
                billingEmail: billingEmail.trim() ? billingEmail.trim() : null,
                timeZone: timeZone.trim() || tenant.data.timeZone,
                industry,
              })
            }}
          >
            <div>
              <label className="text-xs text-pleros-text-3">Slug (read-only)</label>
              <input className="pleros-input mt-1 opacity-70" readOnly value={tenant.data.slug} />
            </div>
            <div>
              <label className="text-xs text-pleros-text-3">Display name</label>
              <input className="pleros-input mt-1" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-pleros-text-3">Billing email</label>
              <input
                className="pleros-input mt-1"
                type="email"
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="text-xs text-pleros-text-3">Time zone</label>
              <input
                className="pleros-input mt-1"
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                placeholder="e.g. America/New_York"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider mb-1 text-pleros-text-3">
                Industry Vertical
              </label>
              <select
                className="pleros-input w-full max-w-xs"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              >
                <option value="GENERAL_WHOLESALE">General Wholesale</option>
                <option value="TOBACCO_VAPE">Tobacco &amp; Vape</option>
                <option value="PHARMA">Pharmaceutical</option>
                <option value="FOOD_BEVERAGE">Food &amp; Beverage</option>
                <option value="ALCOHOL">Alcohol Distribution</option>
              </select>
              <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>
                Controls which compliance engine runs for your account.
              </p>
            </div>
            {tenant.data.suspended && <p className="text-amber-400 text-sm">This tenant is suspended.</p>}
            {patch.error && <p className="text-red-400 text-sm">{errMsg(patch.error)}</p>}
            <button type="submit" className="btn-primary" disabled={!displayName.trim() || patch.isPending}>
              {patch.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        )}
      </div>

      <TaxSettingsCard />
      <AgeVerificationCard />

      {tenant.data?.onboardingSteps && tenant.data.onboardingSteps.length > 0 && (
        <div className="pleros-card">
          <h2 className="text-pleros-white font-semibold font-display mb-1">Onboarding</h2>
          <p className="text-pleros-text-3 text-sm mb-4">Mark steps your organization has finished</p>
          <ul className="space-y-2 text-sm">
            {tenant.data.onboardingSteps.map((s) => (
              <li
                key={s.stepKey}
                className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0"
                style={{ borderColor: 'var(--c-border)' }}
              >
                <span className="text-pleros-text">
                  {STEP_LABELS[s.stepKey] ?? s.stepKey.replace(/_/g, ' ')}
                </span>
                <label className="flex items-center gap-2 cursor-pointer text-pleros-text-3 text-xs">
                  <input
                    type="checkbox"
                    checked={s.completed}
                    disabled={patchStep.isPending}
                    onChange={(e) => patchStep.mutate({ stepKey: s.stepKey, completed: e.target.checked })}
                  />
                  Done
                </label>
              </li>
            ))}
          </ul>
          {patchStep.error && <p className="text-red-400 text-xs mt-2">{errMsg(patchStep.error)}</p>}
        </div>
      )}
    </div>
  )
}

function TaxSettingsCard() {
  const qc = useQueryClient()
  const taxQ = useQuery<{ salesTaxRate: number; salesTaxPercent: number }>({
    queryKey: ['tax-settings'],
    queryFn: () => api.get('/tax/settings'),
  })
  const [percent, setPercent] = useState('')

  useEffect(() => {
    if (taxQ.data) setPercent(String(taxQ.data.salesTaxPercent))
  }, [taxQ.data])

  const saveMut = useMutation({
    mutationFn: (rate: number) => api.patch('/tax/settings', { salesTaxRate: rate }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tax-settings'] }),
  })

  const parsed = Number.parseFloat(percent)
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 50

  return (
    <div className="pleros-card">
      <h2 className="text-pleros-white font-semibold font-display mb-1">Sales tax</h2>
      <p className="text-pleros-text-3 text-sm mb-4">
        Applied to orders, quotes, and POS transactions for this tenant.
      </p>
      {taxQ.isLoading ? (
        <div className="skeleton h-10 w-48" />
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) saveMut.mutate(+(parsed / 100).toFixed(6))
          }}
        >
          <div>
            <label className="text-xs text-pleros-text-3">Sales tax rate (%)</label>
            <input
              className="pleros-input mt-1 w-32"
              type="number"
              step="0.01"
              min="0"
              max="50"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={!valid || saveMut.isPending}>
            {saveMut.isPending ? 'Saving…' : 'Save tax rate'}
          </button>
        </form>
      )}
      {saveMut.error && <p className="text-red-400 text-sm mt-2">{errMsg(saveMut.error)}</p>}
      {saveMut.isSuccess && <p className="text-emerald-400 text-sm mt-2">Tax rate updated.</p>}
    </div>
  )
}

type AgeVerificationPolicy = {
  enabled: boolean
  minimumAge: number
  requireTobaccoLicense: boolean
  requirePosAttestation: boolean
  requireDeliveryConfirmation: boolean
}

function AgeVerificationCard() {
  const qc = useQueryClient()
  const policyQ = useQuery<AgeVerificationPolicy>({
    queryKey: ['age-verification-policy'],
    queryFn: () => api.get('/compliance/age-verification'),
  })
  const [form, setForm] = useState<AgeVerificationPolicy>({
    enabled: false,
    minimumAge: 21,
    requireTobaccoLicense: true,
    requirePosAttestation: true,
    requireDeliveryConfirmation: true,
  })

  useEffect(() => {
    if (policyQ.data) setForm(policyQ.data)
  }, [policyQ.data])

  const saveMut = useMutation({
    mutationFn: (body: AgeVerificationPolicy) => api.patch('/compliance/age-verification', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['age-verification-policy'] }),
  })

  const ageValid = Number.isFinite(form.minimumAge) && form.minimumAge >= 18 && form.minimumAge <= 99

  return (
    <div className="pleros-card">
      <h2 className="text-pleros-white font-semibold font-display mb-1">Age verification</h2>
      <p className="text-pleros-text-3 text-sm mb-4">
        Enforce minimum age and license checks for tobacco / age-restricted SKUs on B2B, POS, and delivery.
      </p>
      {policyQ.isLoading ? (
        <div className="skeleton h-24 w-full" />
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (ageValid) saveMut.mutate(form)
          }}
        >
          <label className="flex items-center gap-2 cursor-pointer text-sm text-pleros-text">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            Enable age verification for this tenant
          </label>
          <div>
            <label className="text-xs text-pleros-text-3">Default minimum age</label>
            <input
              className="pleros-input mt-1 w-32"
              type="number"
              min={18}
              max={99}
              value={form.minimumAge}
              onChange={(e) => setForm((f) => ({ ...f, minimumAge: Number(e.target.value) || 21 }))}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-pleros-text">
            <input
              type="checkbox"
              checked={form.requireTobaccoLicense}
              onChange={(e) => setForm((f) => ({ ...f, requireTobaccoLicense: e.target.checked }))}
            />
            Require licensed customer for B2B / admin restricted orders
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-pleros-text">
            <input
              type="checkbox"
              checked={form.requirePosAttestation}
              onChange={(e) => setForm((f) => ({ ...f, requirePosAttestation: e.target.checked }))}
            />
            Require POS ID / DOB attestation for restricted sales
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-pleros-text">
            <input
              type="checkbox"
              checked={form.requireDeliveryConfirmation}
              onChange={(e) => setForm((f) => ({ ...f, requireDeliveryConfirmation: e.target.checked }))}
            />
            Require delivery POD age confirmation for restricted orders
          </label>
          <button type="submit" className="btn-primary" disabled={!ageValid || saveMut.isPending}>
            {saveMut.isPending ? 'Saving…' : 'Save age verification'}
          </button>
        </form>
      )}
      {saveMut.error && <p className="text-red-400 text-sm mt-2">{errMsg(saveMut.error)}</p>}
      {saveMut.isSuccess && <p className="text-emerald-400 text-sm mt-2">Age verification policy updated.</p>}
    </div>
  )
}
