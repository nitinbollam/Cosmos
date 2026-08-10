import { paymentDb } from './db'
import { ApiError } from './session'
import * as stripe from './stripe'
import { requireStripeConnectContext } from './tenant-stripe-connect'
import { resolveStripeCustomerId } from './stripe-customer-sync'

export async function listSavedPaymentMethods(tenantId: string, customerId: string) {
  const connectCtx = await requireStripeConnectContext(tenantId)
  const rows = await paymentDb.savedPaymentMethod.findMany({
    where: { tenantId, customerId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  })
  return rows.filter(
    (r) =>
      !r.stripeConnectedAccountId || r.stripeConnectedAccountId === connectCtx.connectedAccountId,
  )
}

export async function savePaymentMethod(
  tenantId: string,
  customerId: string,
  dto: {
    stripePaymentMethodId: string
    brand?: string
    last4?: string
    expMonth?: number
    expYear?: number
    isDefault?: boolean
  },
) {
  const connectCtx = await requireStripeConnectContext(tenantId)
  const pmId = dto.stripePaymentMethodId.trim()
  if (!pmId) throw new ApiError(400, 'stripePaymentMethodId required')
  if (pmId.startsWith('pm_demo_')) {
    throw new ApiError(400, 'Demo payment methods are not supported — use checkout to save a real card')
  }

  if (pmId.startsWith('pm_')) {
    const stripeCustomerId = await resolveStripeCustomerId(tenantId, customerId)
    await stripe.attachPaymentMethod(connectCtx, stripeCustomerId, pmId)
  }

  if (dto.isDefault) {
    await paymentDb.savedPaymentMethod.updateMany({
      where: { tenantId, customerId },
      data: { isDefault: false },
    })
  }

  return paymentDb.savedPaymentMethod.create({
    data: {
      tenantId,
      customerId,
      stripePaymentMethodId: pmId,
      stripeConnectedAccountId: connectCtx.connectedAccountId,
      brand: dto.brand,
      last4: dto.last4,
      expMonth: dto.expMonth,
      expYear: dto.expYear,
      isDefault: dto.isDefault ?? false,
    },
  })
}

export async function deleteSavedPaymentMethod(tenantId: string, customerId: string, id: string) {
  const connectCtx = await requireStripeConnectContext(tenantId)
  const row = await paymentDb.savedPaymentMethod.findFirst({ where: { id, tenantId, customerId } })
  if (!row) throw new ApiError(404, 'Payment method not found')
  if (
    row.stripePaymentMethodId.startsWith('pm_') &&
    !row.stripePaymentMethodId.startsWith('pm_demo_') &&
    (!row.stripeConnectedAccountId || row.stripeConnectedAccountId === connectCtx.connectedAccountId)
  ) {
    await stripe.detachPaymentMethod(connectCtx, row.stripePaymentMethodId).catch(() => undefined)
  }
  await paymentDb.savedPaymentMethod.delete({ where: { id } })
  return { deleted: true }
}

export async function setDefaultPaymentMethod(tenantId: string, customerId: string, id: string) {
  await requireStripeConnectContext(tenantId)
  const row = await paymentDb.savedPaymentMethod.findFirst({ where: { id, tenantId, customerId } })
  if (!row) throw new ApiError(404, 'Payment method not found')
  await paymentDb.savedPaymentMethod.updateMany({ where: { tenantId, customerId }, data: { isDefault: false } })
  return paymentDb.savedPaymentMethod.update({ where: { id }, data: { isDefault: true } })
}
