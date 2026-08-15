import { loadStripe } from '@stripe/stripe-js'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

export type StripeClientConfig = {
  publishableKey: string
  stripeAccount: string | null
  chargesEnabled: boolean
}

type ApiGet = <T>(path: string) => Promise<T>

export function useStripeConnect(apiGet: ApiGet, queryKeyPrefix = 'stripe-config') {
  const configQ = useQuery({
    queryKey: [queryKeyPrefix, 'client-config'],
    queryFn: () => apiGet<StripeClientConfig>('/payments/stripe/config'),
    staleTime: 60_000,
  })

  const stripePromise = useMemo(() => {
    const pk = configQ.data?.publishableKey || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ''
    if (!pk) return null
    const acct = configQ.data?.stripeAccount
    return acct ? loadStripe(pk, { stripeAccount: acct }) : loadStripe(pk)
  }, [configQ.data?.publishableKey, configQ.data?.stripeAccount])

  return {
    stripePromise,
    config: configQ.data,
    loading: configQ.isLoading,
    error: configQ.error,
    chargesEnabled: configQ.data?.chargesEnabled ?? false,
  }
}

export type StripeConnectStatus = {
  stripeConnectedAccountId: string | null
  stripeChargesEnabled: boolean
  stripePayoutsEnabled: boolean
  stripeDetailsSubmitted: boolean
  onboardingStatus: 'not_started' | 'pending' | 'restricted' | 'ready'
  platformFeeConfigured: boolean
  connectWebhookConfigured: boolean
}

export function connectStatusLabel(status: StripeConnectStatus['onboardingStatus']): string {
  switch (status) {
    case 'not_started':
      return 'Not started'
    case 'pending':
      return 'Pending — finish onboarding'
    case 'restricted':
      return 'Restricted — resolve in Stripe'
    case 'ready':
      return 'Charges enabled'
    default:
      return status
  }
}
