import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlerosLogo } from '@/components/pleros-logo'
import { api } from '@/lib/api-admin'

type TenantMe = {
  displayName: string
  billingEmail?: string | null
  timeZone: string
  industry?: string
  onboardingPhase: string
  onboardingSteps?: Array<{ stepKey: string; completed: boolean }>
}

const STEPS = [
  { key: 'ORG_PROFILE', title: 'Organization profile', blurb: 'How your company appears in Pleros.' },
  { key: 'BILLING_CONTACT', title: 'Billing contact', blurb: 'Where we send invoices for your subscription.' },
  { key: 'FIRST_WAREHOUSE', title: 'First warehouse', blurb: 'Your primary receiving and fulfillment location.' },
  { key: 'COMPLIANCE_ACK', title: 'Compliance', blurb: 'Confirm you understand regulated-product obligations.' },
] as const

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

export default function OnboardingPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const tenantQ = useQuery<TenantMe>({
    queryKey: ['tenant-me'],
    queryFn: () => api.get('/tenants/me'),
  })

  const completed = useMemo(() => {
    const set = new Set((tenantQ.data?.onboardingSteps ?? []).filter((s) => s.completed).map((s) => s.stepKey))
    return set
  }, [tenantQ.data?.onboardingSteps])

  const activeIndex = useMemo(() => {
    const idx = STEPS.findIndex((s) => !completed.has(s.key))
    return idx === -1 ? STEPS.length - 1 : idx
  }, [completed])

  const activeStep = STEPS[activeIndex] ?? STEPS[STEPS.length - 1]

  useEffect(() => {
    if (tenantQ.data?.onboardingPhase === 'READY') {
      navigate('/admin', { replace: true })
    }
  }, [tenantQ.data?.onboardingPhase, navigate])

  const patchStep = useMutation({
    mutationFn: (stepKey: string) =>
      api.patch(`/tenants/me/onboarding-steps/${encodeURIComponent(stepKey)}`, { completed: true }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-me'] }),
  })

  if (tenantQ.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-pleros-text-3 text-sm">
        Loading setup…
      </div>
    )
  }

  const allDone = STEPS.every((s) => completed.has(s.key))

  return (
    <div className="min-h-screen p-6" style={{ background: 'var(--c-bg)' }}>
      <div className="max-w-xl mx-auto space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <PlerosLogo size="lg" />
          </div>
          <h1 className="text-2xl font-bold text-pleros-white" style={{ fontFamily: 'var(--font-display)' }}>
            Welcome to Pleros
          </h1>
          <p className="text-sm mt-2 text-pleros-text-3">
            Complete these steps to configure your workspace. You can leave and resume anytime.
          </p>
        </div>

        <ol className="flex gap-2">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{
                background:
                  completed.has(s.key) ? 'var(--c-success)' : i === activeIndex ? 'var(--c-accent)' : 'var(--c-border)',
              }}
              title={s.title}
            />
          ))}
        </ol>

        <div className="pleros-card space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-pleros-text-3">
              Step {activeIndex + 1} of {STEPS.length}
            </p>
            <h2 className="text-lg font-semibold text-pleros-white mt-1">{activeStep.title}</h2>
            <p className="text-sm text-pleros-text-3 mt-1">{activeStep.blurb}</p>
          </div>

          {activeStep.key === 'ORG_PROFILE' && (
            <OrgProfileStep
              tenant={tenantQ.data}
              busy={patchStep.isPending}
              onDone={async (body) => {
                await api.patch('/tenants/me', body)
                await patchStep.mutateAsync('ORG_PROFILE')
              }}
              error={patchStep.error ? errMsg(patchStep.error) : null}
            />
          )}
          {activeStep.key === 'BILLING_CONTACT' && (
            <BillingStep
              tenant={tenantQ.data}
              busy={patchStep.isPending}
              onDone={async (billingEmail) => {
                await api.patch('/tenants/me', { billingEmail })
                await patchStep.mutateAsync('BILLING_CONTACT')
              }}
              error={patchStep.error ? errMsg(patchStep.error) : null}
            />
          )}
          {activeStep.key === 'FIRST_WAREHOUSE' && (
            <WarehouseStep
              busy={patchStep.isPending}
              onDone={async (body) => {
                await api.post('/warehouses', body)
                await patchStep.mutateAsync('FIRST_WAREHOUSE')
              }}
              error={patchStep.error ? errMsg(patchStep.error) : null}
            />
          )}
          {activeStep.key === 'COMPLIANCE_ACK' && (
            <ComplianceStep
              busy={patchStep.isPending}
              onDone={() => patchStep.mutateAsync('COMPLIANCE_ACK')}
              error={patchStep.error ? errMsg(patchStep.error) : null}
            />
          )}

          {allDone ? (
            <button type="button" className="btn-primary w-full" onClick={() => navigate('/admin')}>
              Go to dashboard
            </button>
          ) : null}
        </div>

        <p className="text-center text-xs text-pleros-text-3">
          Prefer the full settings page?{' '}
          <a href="/admin/settings" className="text-pleros-accent">
            Open Settings
          </a>
        </p>
      </div>
    </div>
  )
}

function OrgProfileStep(props: {
  tenant?: TenantMe
  busy: boolean
  onDone: (body: { displayName: string; timeZone: string; industry: string }) => Promise<void>
  error: string | null
}) {
  const [displayName, setDisplayName] = useState('')
  const [timeZone, setTimeZone] = useState('America/New_York')
  const [industry, setIndustry] = useState('GENERAL_WHOLESALE')
  const [localErr, setLocalErr] = useState<string | null>(null)

  useEffect(() => {
    if (!props.tenant) return
    setDisplayName(props.tenant.displayName)
    setTimeZone(props.tenant.timeZone || 'America/New_York')
    setIndustry(props.tenant.industry ?? 'GENERAL_WHOLESALE')
  }, [props.tenant])

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        setLocalErr(null)
        if (!displayName.trim()) {
          setLocalErr('Display name is required.')
          return
        }
        void props.onDone({ displayName: displayName.trim(), timeZone: timeZone.trim(), industry }).catch((ex) => {
          setLocalErr(errMsg(ex))
        })
      }}
    >
      <div>
        <label className="text-xs text-pleros-text-3">Display name</label>
        <input className="pleros-input mt-1" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </div>
      <div>
        <label className="text-xs text-pleros-text-3">Time zone</label>
        <input className="pleros-input mt-1" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />
      </div>
      <div>
        <label className="text-xs text-pleros-text-3">Industry</label>
        <select className="pleros-input mt-1 w-full" value={industry} onChange={(e) => setIndustry(e.target.value)}>
          <option value="GENERAL_WHOLESALE">General Wholesale</option>
          <option value="TOBACCO_VAPE">Tobacco &amp; Vape</option>
          <option value="PHARMA">Pharmaceutical</option>
          <option value="FOOD_BEVERAGE">Food &amp; Beverage</option>
          <option value="ALCOHOL">Alcohol Distribution</option>
        </select>
      </div>
      {(localErr || props.error) && <p className="text-sm text-red-400">{localErr ?? props.error}</p>}
      <button type="submit" className="btn-primary" disabled={props.busy}>
        {props.busy ? 'Saving…' : 'Continue'}
      </button>
    </form>
  )
}

function BillingStep(props: {
  tenant?: TenantMe
  busy: boolean
  onDone: (email: string) => Promise<void>
  error: string | null
}) {
  const [email, setEmail] = useState('')
  const [localErr, setLocalErr] = useState<string | null>(null)

  useEffect(() => {
    if (props.tenant?.billingEmail) setEmail(props.tenant.billingEmail)
  }, [props.tenant?.billingEmail])

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        setLocalErr(null)
        const trimmed = email.trim()
        if (!trimmed || !trimmed.includes('@')) {
          setLocalErr('Enter a valid billing email.')
          return
        }
        void props.onDone(trimmed).catch((ex) => setLocalErr(errMsg(ex)))
      }}
    >
      <div>
        <label className="text-xs text-pleros-text-3">Billing email</label>
        <input
          className="pleros-input mt-1"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      {(localErr || props.error) && <p className="text-sm text-red-400">{localErr ?? props.error}</p>}
      <button type="submit" className="btn-primary" disabled={props.busy}>
        {props.busy ? 'Saving…' : 'Continue'}
      </button>
    </form>
  )
}

function WarehouseStep(props: {
  busy: boolean
  onDone: (body: {
    name: string
    code: string
    address: { line1: string; city: string; state: string; postalCode: string; country: string }
    isDefault: boolean
  }) => Promise<void>
  error: string | null
}) {
  const [name, setName] = useState('Main warehouse')
  const [code, setCode] = useState('WH-01')
  const [line1, setLine1] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [localErr, setLocalErr] = useState<string | null>(null)

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        setLocalErr(null)
        if (!name.trim() || !code.trim() || !line1.trim() || !city.trim() || !state.trim() || !postalCode.trim()) {
          setLocalErr('Fill in warehouse name, code, and full address.')
          return
        }
        void props
          .onDone({
            name: name.trim(),
            code: code.trim(),
            address: {
              line1: line1.trim(),
              city: city.trim(),
              state: state.trim(),
              postalCode: postalCode.trim(),
              country: 'US',
            },
            isDefault: true,
          })
          .catch((ex) => setLocalErr(errMsg(ex)))
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-pleros-text-3">Name</label>
          <input className="pleros-input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-pleros-text-3">Code</label>
          <input className="pleros-input mt-1" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="text-xs text-pleros-text-3">Street address</label>
        <input className="pleros-input mt-1" value={line1} onChange={(e) => setLine1(e.target.value)} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-pleros-text-3">City</label>
          <input className="pleros-input mt-1" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-pleros-text-3">State</label>
          <input className="pleros-input mt-1" value={state} onChange={(e) => setState(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-pleros-text-3">ZIP</label>
          <input className="pleros-input mt-1" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
        </div>
      </div>
      {(localErr || props.error) && <p className="text-sm text-red-400">{localErr ?? props.error}</p>}
      <button type="submit" className="btn-primary" disabled={props.busy}>
        {props.busy ? 'Creating…' : 'Create warehouse & continue'}
      </button>
    </form>
  )
}

function ComplianceStep(props: { busy: boolean; onDone: () => Promise<unknown>; error: string | null }) {
  const [ack, setAck] = useState(false)

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ack) return
        void props.onDone()
      }}
    >
      <label className="flex items-start gap-3 cursor-pointer text-sm text-pleros-text">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
        <span>
          I understand that regulated products (tobacco, vape, pharma, alcohol, etc.) may require additional compliance
          reporting, and I am responsible for accurate product and customer data in Pleros.
        </span>
      </label>
      {props.error && <p className="text-sm text-red-400">{props.error}</p>}
      <button type="submit" className="btn-primary" disabled={!ack || props.busy}>
        {props.busy ? 'Finishing…' : 'Complete setup'}
      </button>
    </form>
  )
}
