import * as crm from './crm'
import * as stripe from './stripe'
import { requireStripeConnectContext } from './tenant-stripe-connect'

/** Ensure the CRM customer has a valid Stripe Customer on this distributor's connected account. */
export async function resolveStripeCustomerId(tenantId: string, customerId: string): Promise<string> {
  const connectCtx = await requireStripeConnectContext(tenantId)
  const customer = await crm.getCustomer(tenantId, customerId)

  if (
    customer.stripeCustomerId?.startsWith('cus_') &&
    customer.stripeConnectAccountId === connectCtx.connectedAccountId
  ) {
    return customer.stripeCustomerId
  }

  const stripeCustomerId = await stripe.ensureStripeCustomer(connectCtx, {
    cosmosCustomerId: customer.id,
    tenantId,
    name: customer.name,
    email: customer.email,
    existingStripeCustomerId: customer.stripeCustomerId,
    existingConnectAccountId: customer.stripeConnectAccountId,
  })
  await crm.setStripeCustomerId(tenantId, customer.id, stripeCustomerId, connectCtx.connectedAccountId)
  return stripeCustomerId
}
