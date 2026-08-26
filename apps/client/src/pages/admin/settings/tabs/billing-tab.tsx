import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useQueryParams } from '@/lib/use-query-params'
import { api } from '@/lib/api-admin'
import { TenantMe, errMsg } from '../types'

const PLANS = [
  {
    id: 'STARTER' as const,
    name: 'Starter',
    blurb: 'Core operations for small teams',
  },
  {
    id: 'GROWTH' as const,
    name: 'Growth',
    blurb: 'Scaling workflows and integrations',
  },
  {
    id: 'ENTERPRISE' as const,
    name: 'Enterprise',
    blurb: 'Dedicated support and limits',
  },
]

type BillingStatus = {
  plan: string
  billingStatus: string | null
  billingConfigured: boolean
  pricesConfigured: { growth: boolean; enterprise: boolean }
}

export function BillingTab() {
  const qc = useQueryClient()
  const searchParams = useQueryParams()
  const checkoutResult = searchParams.get('checkout')

  const tenant = useQuery<TenantMe>({
    queryKey: ['tenant-me'],
    queryFn: () => api.get('/tenants/me'),
  })

  const billingQ = useQuery<BillingStatus>({
    queryKey: ['billing-status'],
    queryFn: () => api.get('/tenants/me/billing'),
  })

  const upgradeMut = useMutation({
    mutationFn: async (plan: 'STARTER' | 'GROWTH' | 'ENTERPRISE') => {
      if (billingQ.data?.billingConfigured && plan !== 'STARTER') {
        const { url } = await api.post<{ url: string }>('/tenants/me/billing/checkout', { plan })
        window.location.href = url
        return
      }
      return api.post('/tenants/me/upgrade', { plan })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant-me'] })
      void qc.invalidateQueries({ queryKey: ['billing-status'] })
    },
  })

  const portalMut = useMutation({
    mutationFn: () => api.post<{ url: string }>('/tenants/me/billing/portal'),
    onSuccess: (res) => {
      if (res?.url) window.location.href = res.url
    },
  })

  const current = tenant.data?.plan ?? 'STARTER'
  const stripeOn = billingQ.data?.billingConfigured ?? false

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-pleros-white font-semibold font-display">Billing</h2>
          <p className="text-pleros-text-3 text-sm mt-1">
            {stripeOn
              ? 'Paid plans are billed through Stripe Checkout. Manage your subscription in the billing portal.'
              : 'Stripe is not configured — plan changes apply immediately (local dev only).'}
          </p>
        </div>
        {stripeOn && billingQ.data?.billingStatus ? (
          <button
            type="button"
            className="btn-ghost !text-sm"
            disabled={portalMut.isPending}
            onClick={() => portalMut.mutate()}
          >
            {portalMut.isPending ? 'Opening…' : 'Manage subscription'}
          </button>
        ) : null}
      </div>

      {checkoutResult === 'success' ? (
        <p className="text-sm text-emerald-400">Checkout complete — your plan will update shortly.</p>
      ) : checkoutResult === 'cancel' ? (
        <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Checkout canceled.</p>
      ) : null}

      <div className="pleros-card">
        <h3 className="text-pleros-white font-semibold font-display mb-2">Current plan</h3>
        {tenant.isLoading ? (
          <div className="skeleton h-10 w-48" />
        ) : (
          <>
            <p className="text-2xl font-bold text-pleros-accent font-display">{current}</p>
            {billingQ.data?.billingStatus ? (
              <p className="text-xs text-pleros-text-3 mt-2 capitalize">Subscription: {billingQ.data.billingStatus}</p>
            ) : null}
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => {
          const isCurrent = current === p.id
          const paidUnavailable =
            stripeOn &&
            p.id !== 'STARTER' &&
            !billingQ.data?.pricesConfigured[p.id === 'GROWTH' ? 'growth' : 'enterprise']
          return (
            <div key={p.id} className="pleros-card flex flex-col">
              <h4 className="text-pleros-white font-semibold font-display">{p.name}</h4>
              <p className="text-sm text-pleros-text-3 mt-2 flex-1">{p.blurb}</p>
              <button
                type="button"
                className="btn-primary mt-4 w-full"
                disabled={isCurrent || upgradeMut.isPending || paidUnavailable || (stripeOn && p.id === 'STARTER')}
                onClick={() => upgradeMut.mutate(p.id)}
              >
                {isCurrent
                  ? 'Current plan'
                  : stripeOn && p.id !== 'STARTER'
                    ? `Subscribe to ${p.name}`
                    : p.id === 'STARTER'
                      ? 'Free tier'
                      : `Upgrade to ${p.name}`}
              </button>
              {paidUnavailable ? (
                <p className="text-xs text-amber-400 mt-2">Set STRIPE_PRICE_{p.id} in environment</p>
              ) : null}
            </div>
          )
        })}
      </div>
      {(upgradeMut.error || portalMut.error) && (
        <p className="text-red-400 text-sm">{errMsg(upgradeMut.error ?? portalMut.error)}</p>
      )}
    </div>
  )
}
