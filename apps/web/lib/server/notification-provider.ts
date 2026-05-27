import type { NotificationChannel } from '@/generated/prisma-notification'

export type NotificationDeliveryInput = {
  tenantId: string
  channel: NotificationChannel
  recipient: string
  templateKey: string
  payload: Record<string, unknown>
}

export type NotificationDeliveryResult = {
  provider: 'console' | 'webhook'
  subject: string
  body: string
}

const TEMPLATE_COPY: Record<string, (payload: Record<string, unknown>) => { subject: string; body: string }> = {
  'inventory.low_stock': (p) => ({
    subject: 'Low stock alert',
    body: `SKU ${String(p.skuCode ?? 'unknown')} is at ${String(p.qtyOnHand ?? '?')} units (reorder ${String(p.reorderPoint ?? '?')}).`,
  }),
  'order.created': (p) => ({
    subject: 'New order',
    body: `Order ${String(p.orderId ?? '')} was created for ${String(p.total ?? '')}.`,
  }),
  'order.shipped': (p) => ({
    subject: 'Order shipped',
    body: `Order ${String(p.orderId ?? '')} has shipped.`,
  }),
}

function renderNotification(input: NotificationDeliveryInput): { subject: string; body: string } {
  const fn = TEMPLATE_COPY[input.templateKey]
  if (fn) return fn(input.payload)
  return {
    subject: input.templateKey,
    body: JSON.stringify(input.payload),
  }
}

/** Demo provider: logs locally and optionally POSTs to NOTIFICATION_WEBHOOK_URL. */
export async function deliverNotification(
  input: NotificationDeliveryInput,
): Promise<NotificationDeliveryResult> {
  const { subject, body } = renderNotification(input)
  const line = `[notification] ${input.channel} → ${input.recipient} | ${input.templateKey}`
  console.log(line)
  console.log(`  subject: ${subject}`)
  console.log(`  body: ${body}`)

  const webhook = process.env.NOTIFICATION_WEBHOOK_URL?.trim()
  if (webhook) {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: input.tenantId,
        channel: input.channel,
        recipient: input.recipient,
        templateKey: input.templateKey,
        subject,
        body,
        payload: input.payload,
        sentAt: new Date().toISOString(),
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Notification webhook failed (${res.status}): ${text.slice(0, 200)}`)
    }
    return { provider: 'webhook', subject, body }
  }

  return { provider: 'console', subject, body }
}
