import type { NotificationChannel } from '@/generated/prisma-notification'

export type NotificationDeliveryInput = {
  tenantId: string
  channel: NotificationChannel
  recipient: string
  templateKey: string
  payload: Record<string, unknown>
}

export type NotificationDeliveryResult = {
  provider: 'console' | 'webhook' | 'sendgrid' | 'twilio'
  subject: string
  body: string
}

const TEMPLATE_COPY: Record<string, (payload: Record<string, unknown>) => { subject: string; body: string }> = {
  'inventory.low_stock': (p) => ({
    subject: 'Low stock alert',
    body: `SKU ${String(p.skuCode ?? 'unknown')} is at ${String(p.qtyOnHand ?? '?')} units (reorder ${String(p.reorderPoint ?? '?')}).`,
  }),
  'order.created': (p) => ({
    subject: 'Order confirmation',
    body: `Your order ${String(p.orderId ?? '').slice(0, 12)}… was placed for $${String(p.total ?? '')}. Thank you for your business.`,
  }),
  'order.shipped': (p) => ({
    subject: 'Your order has shipped',
    body: `Order ${String(p.orderId ?? '').slice(0, 12)}… is on its way.`,
  }),
  'invoice.issued': (p) => ({
    subject: `Invoice ${String(p.invoiceNumber ?? '')}`,
    body: `Invoice ${String(p.invoiceNumber ?? '')} for $${String(p.total ?? '')} is ready.${p.dueAt ? ` Due ${String(p.dueAt)}.` : ''} View it in your buyer portal.`,
  }),
  'payment.received': (p) => ({
    subject: 'Payment received',
    body: `We received your payment of $${String(p.amount ?? '')}${p.invoiceNumber ? ` for invoice ${String(p.invoiceNumber)}` : ''}. Thank you.`,
  }),
  'auth.email_verify': (p) => ({
    subject: 'Verify your Pleros email',
    body: `Hi ${String(p.firstName ?? 'there')},\n\nThanks for signing up. Confirm your email within 24 hours:\n\n${String(p.verifyUrl ?? '')}\n\nIf you didn't create an account, you can ignore this email.`,
  }),
  'auth.password_reset': (p) => ({
    subject: 'Reset your Pleros password',
    body: `Hi ${String(p.firstName ?? 'there')},\n\nWe received a request to reset your password. Use the link below within 30 minutes:\n\n${String(p.resetUrl ?? '')}\n\nIf you didn't request this, you can safely ignore this email.`,
  }),
  'tenant.invite': (p) => ({
    subject: `You've been invited to join ${String(p.orgName ?? 'a team')} on Pleros`,
    body: `You've been invited to join ${String(p.orgName ?? 'a team')} as ${String(p.role ?? 'STAFF')}.\n\nAccept the invite within 7 days:\n\n${String(p.inviteUrl ?? '')}`,
  }),
  'marketplace.auction.outbid': (p) => ({
    subject: 'You were outbid on a marketplace auction',
    body: `Another bidder placed $${String(p.newBid ?? '')} on "${String(p.listingTitle ?? 'a listing')}". Place a higher bid before the auction ends.`,
  }),
  'marketplace.auction.won': (p) => ({
    subject: 'You won a marketplace auction',
    body: `Congratulations — you won "${String(p.listingTitle ?? 'a listing')}" for $${String(p.amount ?? '')}. Complete payment in My orders if not already charged.`,
  }),
  'marketplace.payment.due': (p) => ({
    subject: 'Marketplace payment required',
    body: `Order …${String(p.orderId ?? '')} requires payment of $${String(p.amount ?? '')}. Open Marketplace → My orders to pay.`,
  }),
  'marketplace.search.match': (p) => ({
    subject: 'New marketplace listing matches your saved search',
    body: `"${String(p.listingTitle ?? 'A listing')}" in ${String(p.category ?? 'your category')} is now live.`,
  }),
  'marketplace.message.received': (p) => ({
    subject: 'New marketplace order message',
    body: `You have a new message on order …${String(p.orderId ?? '')}: ${String(p.preview ?? '')}`,
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

async function sendViaSendGrid(recipient: string, subject: string, body: string): Promise<void> {
  const key = process.env.SENDGRID_API_KEY?.trim()
  if (!key) throw new Error('SENDGRID_API_KEY not configured')
  const from = process.env.SENDGRID_FROM_EMAIL?.trim() || 'noreply@pleros.local'
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: recipient }] }],
      from: { email: from, name: 'Pleros' },
      subject,
      content: [{ type: 'text/plain', value: body }],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`SendGrid failed (${res.status}): ${text.slice(0, 200)}`)
  }
}

async function sendViaTwilio(recipient: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const token = process.env.TWILIO_AUTH_TOKEN?.trim()
  const from = process.env.TWILIO_FROM_NUMBER?.trim()
  if (!sid || !token || !from) throw new Error('Twilio not configured')
  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const params = new URLSearchParams({ To: recipient, From: from, Body: body })
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Twilio failed (${res.status}): ${text.slice(0, 200)}`)
  }
}

async function sendViaWebhook(
  input: NotificationDeliveryInput,
  subject: string,
  body: string,
): Promise<NotificationDeliveryResult> {
  const webhook = process.env.NOTIFICATION_WEBHOOK_URL?.trim()
  if (!webhook) throw new Error('NOTIFICATION_WEBHOOK_URL not configured')
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

/** Delivers via SendGrid/Twilio when configured; falls back to webhook or console. */
export async function deliverNotification(
  input: NotificationDeliveryInput,
): Promise<NotificationDeliveryResult> {
  const { subject, body } = renderNotification(input)

  if (input.channel === 'EMAIL' && process.env.SENDGRID_API_KEY?.trim()) {
    await sendViaSendGrid(input.recipient, subject, body)
    console.log(`[notification] sendgrid → ${input.recipient} | ${input.templateKey}`)
    return { provider: 'sendgrid', subject, body }
  }

  if (input.channel === 'SMS' && process.env.TWILIO_ACCOUNT_SID?.trim()) {
    await sendViaTwilio(input.recipient, `${subject}\n${body}`)
    console.log(`[notification] twilio → ${input.recipient} | ${input.templateKey}`)
    return { provider: 'twilio', subject, body }
  }

  if (process.env.NOTIFICATION_WEBHOOK_URL?.trim()) {
    return sendViaWebhook(input, subject, body)
  }

  const line = `[notification] ${input.channel} → ${input.recipient} | ${input.templateKey}`
  console.log(line)
  console.log(`  subject: ${subject}`)
  console.log(`  body: ${body}`)
  return { provider: 'console', subject, body }
}
