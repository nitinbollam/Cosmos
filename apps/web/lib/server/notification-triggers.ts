import { NotificationChannel } from '@/generated/prisma-notification'
import * as crm from './crm'
import * as notifications from './notifications'
import { shouldSendCustomerNotification } from './customer-notification-prefs'

async function customerContact(tenantId: string, customerId: string) {
  try {
    const customer = await crm.getCustomer(tenantId, customerId)
    return { email: customer.email?.trim() || null, phone: customer.phone?.trim() || null, name: customer.name }
  } catch {
    return { email: null, phone: null, name: null }
  }
}

export async function notifyOrderCreated(
  tenantId: string,
  orderId: string,
  customerId: string,
  totalAmount: number,
) {
  const contact = await customerContact(tenantId, customerId)
  if (!contact.email) return
  if (!(await shouldSendCustomerNotification(tenantId, customerId, 'order.created', NotificationChannel.EMAIL))) {
    return
  }
  void notifications
    .send(
      tenantId,
      {
        channel: NotificationChannel.EMAIL,
        recipient: contact.email,
        templateKey: 'order.created',
        payload: { orderId, total: totalAmount.toFixed(2), customerName: contact.name },
      },
      `order-created:${orderId}`,
    )
    .catch(() => undefined)
}

export async function notifyOrderShipped(tenantId: string, orderId: string, customerId: string) {
  const contact = await customerContact(tenantId, customerId)
  if (!contact.email) return
  if (!(await shouldSendCustomerNotification(tenantId, customerId, 'order.shipped', NotificationChannel.EMAIL))) {
    return
  }
  void notifications
    .send(
      tenantId,
      {
        channel: NotificationChannel.EMAIL,
        recipient: contact.email,
        templateKey: 'order.shipped',
        payload: { orderId, customerName: contact.name },
      },
      `order-shipped:${orderId}`,
    )
    .catch(() => undefined)
}

export async function notifyInvoiceIssued(
  tenantId: string,
  invoiceId: string,
  orderId: string,
  customerId: string,
  invoiceNumber: string,
  totalAmount: number,
  dueAt?: Date | null,
) {
  const contact = await customerContact(tenantId, customerId)
  if (!contact.email) return
  if (!(await shouldSendCustomerNotification(tenantId, customerId, 'invoice.issued', NotificationChannel.EMAIL))) {
    return
  }
  void notifications
    .send(
      tenantId,
      {
        channel: NotificationChannel.EMAIL,
        recipient: contact.email,
        templateKey: 'invoice.issued',
        payload: {
          invoiceId,
          orderId,
          invoiceNumber,
          total: totalAmount.toFixed(2),
          dueAt: dueAt?.toISOString().slice(0, 10) ?? null,
          customerName: contact.name,
        },
      },
      `invoice-issued:${invoiceId}`,
    )
    .catch(() => undefined)
}

export async function notifyPaymentReceived(
  tenantId: string,
  orderId: string,
  customerId: string,
  amount: number,
  invoiceNumber?: string,
) {
  const contact = await customerContact(tenantId, customerId)
  if (!contact.email) return
  if (!(await shouldSendCustomerNotification(tenantId, customerId, 'payment.received', NotificationChannel.EMAIL))) {
    return
  }
  void notifications
    .send(
      tenantId,
      {
        channel: NotificationChannel.EMAIL,
        recipient: contact.email,
        templateKey: 'payment.received',
        payload: {
          orderId,
          amount: amount.toFixed(2),
          invoiceNumber: invoiceNumber ?? null,
          customerName: contact.name,
        },
      },
      `payment-received:${orderId}:${amount.toFixed(2)}`,
    )
    .catch(() => undefined)
}

export async function notifyGiftCardIssued(
  tenantId: string,
  giftCardId: string,
  code: string,
  amount: number,
  customerId?: string,
) {
  if (!customerId) return
  const contact = await customerContact(tenantId, customerId)
  if (!contact.email) return
  void notifications
    .send(
      tenantId,
      {
        channel: NotificationChannel.EMAIL,
        recipient: contact.email,
        templateKey: 'gift_card.issued',
        payload: { giftCardId, code, amount: amount.toFixed(2), customerName: contact.name },
      },
      `gift-card-issued:${giftCardId}`,
    )
    .catch(() => undefined)
}

export async function notifySubscriptionOrderCreated(
  tenantId: string,
  subscriptionId: string,
  orderId: string,
  customerId: string,
) {
  const contact = await customerContact(tenantId, customerId)
  if (!contact.email) return
  void notifications
    .send(
      tenantId,
      {
        channel: NotificationChannel.EMAIL,
        recipient: contact.email,
        templateKey: 'subscription.order_created',
        payload: { subscriptionId, orderId, customerName: contact.name },
      },
      `subscription-order:${subscriptionId}:${orderId}`,
    )
    .catch(() => undefined)
}

export async function notifySubscriptionPaymentFailed(
  tenantId: string,
  subscriptionId: string,
  customerId: string,
  reason: string,
) {
  const contact = await customerContact(tenantId, customerId)
  if (!contact.email) return
  void notifications
    .send(
      tenantId,
      {
        channel: NotificationChannel.EMAIL,
        recipient: contact.email,
        templateKey: 'subscription.payment_failed',
        payload: { subscriptionId, reason, customerName: contact.name },
      },
      `subscription-failed:${subscriptionId}`,
    )
    .catch(() => undefined)
}

export async function notifyLowStock(
  tenantId: string,
  skuId: string,
  skuCode: string,
  qtyOnHand: number,
  reorderPoint: number,
  adminEmail?: string,
) {
  const recipient = adminEmail?.trim() || process.env.PLEROS_OPS_EMAIL?.trim()
  if (!recipient) return
  void notifications
    .send(
      tenantId,
      {
        channel: NotificationChannel.EMAIL,
        recipient,
        templateKey: 'inventory.low_stock',
        payload: { skuId, skuCode, qtyOnHand, reorderPoint },
      },
      `low-stock:${skuId}:${qtyOnHand}`,
    )
    .catch(() => undefined)
}
