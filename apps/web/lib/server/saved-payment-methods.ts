import { paymentDb } from './db'
import { ApiError } from './session'

export async function listSavedPaymentMethods(tenantId: string, customerId: string) {
  return paymentDb.savedPaymentMethod.findMany({
    where: { tenantId, customerId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  })
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
  if (!dto.stripePaymentMethodId.trim()) throw new ApiError(400, 'stripePaymentMethodId required')

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
      stripePaymentMethodId: dto.stripePaymentMethodId.trim(),
      brand: dto.brand,
      last4: dto.last4,
      expMonth: dto.expMonth,
      expYear: dto.expYear,
      isDefault: dto.isDefault ?? false,
    },
  })
}

export async function deleteSavedPaymentMethod(tenantId: string, customerId: string, id: string) {
  const row = await paymentDb.savedPaymentMethod.findFirst({ where: { id, tenantId, customerId } })
  if (!row) throw new ApiError(404, 'Payment method not found')
  await paymentDb.savedPaymentMethod.delete({ where: { id } })
  return { deleted: true }
}

export async function setDefaultPaymentMethod(tenantId: string, customerId: string, id: string) {
  const row = await paymentDb.savedPaymentMethod.findFirst({ where: { id, tenantId, customerId } })
  if (!row) throw new ApiError(404, 'Payment method not found')
  await paymentDb.savedPaymentMethod.updateMany({ where: { tenantId, customerId }, data: { isDefault: false } })
  return paymentDb.savedPaymentMethod.update({ where: { id }, data: { isDefault: true } })
}
