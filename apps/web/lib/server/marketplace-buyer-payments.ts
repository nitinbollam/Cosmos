import { marketplaceDb } from './db'
import { getOrCreateMarketplaceProfile } from './marketplace-profiles'
import * as stripe from './stripe'
import { ApiError } from './session'

export async function ensureMarketplacePlatformCustomer(tenantId: string): Promise<string> {
  const profile = await getOrCreateMarketplaceProfile(tenantId)
  if (profile.stripePlatformCustomerId?.startsWith('cus_')) {
    return profile.stripePlatformCustomerId
  }
  if (!stripe.isStripeConfigured()) throw new ApiError(503, 'Stripe is not configured')

  const client = stripe.getStripeClient()
  const customer = await client.customers.create({
    metadata: { cosmosTenantId: tenantId, cosmosMarketplaceBuyer: 'true' },
  })
  await marketplaceDb.marketplaceProfile.update({
    where: { tenantId },
    data: { stripePlatformCustomerId: customer.id },
  })
  return customer.id
}

export async function listMarketplacePaymentMethods(tenantId: string) {
  await getOrCreateMarketplaceProfile(tenantId)
  return marketplaceDb.marketplaceBuyerPaymentMethod.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  })
}

export async function saveMarketplacePaymentMethod(
  tenantId: string,
  dto: {
    stripePaymentMethodId: string
    brand?: string
    last4?: string
    expMonth?: number
    expYear?: number
    isDefault?: boolean
  },
) {
  stripe.assertRealStripePaymentMethodId(dto.stripePaymentMethodId)
  const stripeCustomerId = await ensureMarketplacePlatformCustomer(tenantId)
  const client = stripe.getStripeClient()
  try {
    await client.paymentMethods.attach(dto.stripePaymentMethodId, { customer: stripeCustomerId })
  } catch (error) {
    const se = error as { code?: string; message?: string }
    if (!se.message?.includes('already been attached') && se.code !== 'resource_already_exists') throw error
  }

  if (dto.isDefault ?? true) {
    await marketplaceDb.marketplaceBuyerPaymentMethod.updateMany({
      where: { tenantId },
      data: { isDefault: false },
    })
  }

  return marketplaceDb.marketplaceBuyerPaymentMethod.upsert({
    where: {
      tenantId_stripePaymentMethodId: { tenantId, stripePaymentMethodId: dto.stripePaymentMethodId },
    },
    create: {
      tenantId,
      stripePaymentMethodId: dto.stripePaymentMethodId,
      brand: dto.brand,
      last4: dto.last4,
      expMonth: dto.expMonth,
      expYear: dto.expYear,
      isDefault: dto.isDefault ?? true,
    },
    update: {
      brand: dto.brand,
      last4: dto.last4,
      expMonth: dto.expMonth,
      expYear: dto.expYear,
      isDefault: dto.isDefault ?? true,
    },
  })
}

export async function getDefaultMarketplacePaymentMethod(tenantId: string) {
  return marketplaceDb.marketplaceBuyerPaymentMethod.findFirst({
    where: { tenantId, isDefault: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function requireMarketplacePaymentMethod(tenantId: string) {
  const pm = await getDefaultMarketplacePaymentMethod(tenantId)
  if (!pm) {
    throw new ApiError(402, 'Add a payment method in Marketplace settings before bidding')
  }
  return pm
}

export async function deleteMarketplacePaymentMethod(tenantId: string, id: string) {
  const row = await marketplaceDb.marketplaceBuyerPaymentMethod.findFirst({ where: { id, tenantId } })
  if (!row) throw new ApiError(404, 'Payment method not found')
  if (stripe.isStripeConfigured() && row.stripePaymentMethodId.startsWith('pm_')) {
    const client = stripe.getStripeClient()
    await client.paymentMethods.detach(row.stripePaymentMethodId).catch(() => undefined)
  }
  await marketplaceDb.marketplaceBuyerPaymentMethod.delete({ where: { id } })
  return { deleted: true }
}
