import type { NotificationChannel } from '@/generated/prisma-notification'
import { tenantDb } from './db'
import { ApiError } from './session'

export type CustomerNotificationPrefs = {
  emailEnabled: boolean
  smsEnabled: boolean
  orderUpdates: boolean
  invoiceAlerts: boolean
}

export const DEFAULT_CUSTOMER_NOTIFICATION_PREFS: CustomerNotificationPrefs = {
  emailEnabled: true,
  smsEnabled: false,
  orderUpdates: true,
  invoiceAlerts: true,
}

function readPrefsMap(settings: unknown): Record<string, Partial<CustomerNotificationPrefs>> {
  const root = (settings ?? {}) as Record<string, unknown>
  return (root.customerNotificationPrefs ?? {}) as Record<string, Partial<CustomerNotificationPrefs>>
}

export async function getCustomerNotificationPrefs(
  tenantId: string,
  customerId: string,
): Promise<CustomerNotificationPrefs> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org) return DEFAULT_CUSTOMER_NOTIFICATION_PREFS
  const stored = readPrefsMap(org.settings)[customerId] ?? {}
  return { ...DEFAULT_CUSTOMER_NOTIFICATION_PREFS, ...stored }
}

export async function patchCustomerNotificationPrefs(
  tenantId: string,
  customerId: string,
  patch: Partial<CustomerNotificationPrefs>,
): Promise<CustomerNotificationPrefs> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org) throw new ApiError(404, 'Tenant organization not found')

  const map = { ...readPrefsMap(org.settings) }
  const next = { ...DEFAULT_CUSTOMER_NOTIFICATION_PREFS, ...map[customerId], ...patch }
  map[customerId] = next

  const settings = { ...((org.settings as Record<string, unknown>) ?? {}), customerNotificationPrefs: map }
  await tenantDb.tenantOrganization.update({
    where: { id: tenantId },
    data: { settings },
  })
  return next
}

export async function shouldSendCustomerNotification(
  tenantId: string,
  customerId: string,
  templateKey: string,
  channel: NotificationChannel,
): Promise<boolean> {
  const prefs = await getCustomerNotificationPrefs(tenantId, customerId)
  if (channel === 'EMAIL' && !prefs.emailEnabled) return false
  if (channel === 'SMS' && !prefs.smsEnabled) return false
  if (templateKey.startsWith('order.') && !prefs.orderUpdates) return false
  if ((templateKey === 'invoice.issued' || templateKey === 'payment.received') && !prefs.invoiceAlerts) {
    return false
  }
  return true
}
