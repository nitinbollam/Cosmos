import type { NotificationChannel } from '@/generated/prisma-notification'

export type NotificationDeliveryInput = {
  tenantId: string
  channel: NotificationChannel
  recipient: string
  templateKey: string
  payload: Record<string, unknown>
}

export type NotificationDeliveryResult = {
  provider: 'console' | 'webhook' | 'sendgrid' | 'twilio' | 'push'
  subject: string
  body: string
}

/** Public app origin used to build deep links inside notification emails. Mirrors auth.ts's appPublicUrl(). */
function appPublicUrl(): string {
  const configured = process.env.APP_URL?.trim()
  return configured ? configured.replace(/\/$/, '') : 'http://localhost:4000'
}

/** Short human-facing reference for an order — the app's own UI shows the same last-8-chars-uppercase form. */
/** ORD-1042 when the payload carries the order number, else the tail of the id (orders not yet numbered). */
function shortOrderRef(orderId: string, orderNumber?: unknown): string {
  if (typeof orderNumber === 'number') return `ORD-${orderNumber}`
  return `ORD-${orderId.slice(-6).toUpperCase()}`
}

const TEMPLATE_COPY: Record<string, (payload: Record<string, unknown>) => { subject: string; body: string }> = {
  'inventory.low_stock': (p) => ({
    subject: 'Low stock alert',
    body: `SKU ${String(p.skuCode ?? 'unknown')} is at ${String(p.qtyOnHand ?? '?')} units (reorder ${String(p.reorderPoint ?? '?')}).`,
  }),
  'order.created': (p) => {
    const orderId = String(p.orderId ?? '')
    const orderUrl = `${appPublicUrl()}/orders/${orderId}`
    return {
      subject: 'Order confirmation',
      body: `Your order ${shortOrderRef(orderId, p.orderNumber)} was placed for $${String(p.total ?? '')}. Thank you for your business.\n\nView your order: ${orderUrl}`,
    }
  },
  'order.shipped': (p) => {
    const orderId = String(p.orderId ?? '')
    const orderUrl = `${appPublicUrl()}/orders/${orderId}`
    return {
      subject: 'Your order has shipped',
      body: `Order ${shortOrderRef(orderId, p.orderNumber)} is on its way.\n\nTrack your order: ${orderUrl}`,
    }
  },
  'invoice.issued': (p) => {
    const invoiceId = String(p.invoiceId ?? '')
    const invoiceUrl = `${appPublicUrl()}/invoices/${invoiceId}`
    return {
      subject: `Invoice ${String(p.invoiceNumber ?? '')}`,
      body: `Invoice ${String(p.invoiceNumber ?? '')} for $${String(p.total ?? '')} is ready.${p.dueAt ? ` Due ${String(p.dueAt)}.` : ''}\n\nView and pay your invoice: ${invoiceUrl}`,
    }
  },
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

/**
 * Push copy: short, and safe on a lock screen (an order reference, never amounts). `url` is a
 * same-origin path the notification opens.
 */
const PUSH_COPY: Record<
  string,
  (payload: Record<string, unknown>) => { title: string; body: string; url?: string; tag?: string }
> = {
  'order.shipped': (p) => {
    const orderId = String(p.orderId ?? '')
    return {
      title: 'Your order has shipped',
      body: `Order ${shortOrderRef(orderId, p.orderNumber)} is on its way.`,
      url: `/orders/${encodeURIComponent(orderId)}`,
      // One notification per order: a second shipment doesn't replace the first on screen.
      tag: `order.shipped:${orderId}`,
    }
  },
}

function renderPush(input: NotificationDeliveryInput, subject: string) {
  const fn = PUSH_COPY[input.templateKey]
  if (fn) return { tag: input.templateKey, ...fn(input.payload) }
  return { title: subject, body: '', tag: input.templateKey }
}

/** A file sent with an email: `content` is base64, as SendGrid expects. */
export type EmailAttachment = { filename: string; type: string; content: string }

/** Bigger files are left off (the email still links to the document); SendGrid allows 30 MB in all. */
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024

/**
 * Files that go with an email, built when it is sent (never stored with the notification, so a
 * retry builds them again). If one can't be built the email still goes out without it — invoice
 * emails link to the invoice anyway.
 */
async function emailAttachments(input: NotificationDeliveryInput): Promise<EmailAttachment[]> {
  if (input.templateKey !== 'invoice.issued' || typeof input.payload.invoiceId !== 'string') return []
  try {
    const { getInvoice, getInvoicePdfDocument } = await import('./invoices')
    // Only to the invoice's own customer: a notification can be sent to any address by hand
    // (Notifications → Send), and that must not become a way to mail someone else's invoice out.
    const invoice = await getInvoice(input.tenantId, input.payload.invoiceId)
    const { getCustomer } = await import('./crm')
    const customerEmail = (await getCustomer(input.tenantId, invoice.customerId)).email?.trim().toLowerCase()
    if (!customerEmail || customerEmail !== input.recipient.trim().toLowerCase()) {
      console.warn(`[notification] invoice ${invoice.invoiceNumber} not attached: recipient is not the invoice's customer`)
      return []
    }
    const { pdf, invoiceNumber } = await getInvoicePdfDocument(input.tenantId, input.payload.invoiceId)
    if (pdf.length > MAX_ATTACHMENT_BYTES) {
      console.warn(`[notification] invoice ${invoiceNumber} PDF is ${pdf.length} bytes; sent without attachment`)
      return []
    }
    const filename = `${invoiceNumber.replace(/[^\w.-]+/g, '_').slice(0, 64) || 'invoice'}.pdf`
    return [{ filename, type: 'application/pdf', content: pdf.toString('base64') }]
  } catch (err) {
    console.error(`[notification] could not attach invoice PDF for ${String(input.payload.invoiceId)}:`, err)
    return []
  }
}

async function sendViaSendGrid(
  recipient: string,
  subject: string,
  body: string,
  attachments: EmailAttachment[] = [],
): Promise<void> {
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
      ...(attachments.length > 0
        ? { attachments: attachments.map((a) => ({ ...a, disposition: 'attachment' })) }
        : {}),
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
  // The relay sends the email, so it gets the same attachments SendGrid would.
  const attachments = input.channel === 'EMAIL' ? await emailAttachments(input) : []
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
      ...(attachments.length > 0 ? { attachments } : {}),
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

  // PUSH: the recipient is a user id, delivered to that user's registered devices.
  if (input.channel === 'PUSH') {
    const { sendPushToUser } = await import('./push')
    const result = await sendPushToUser(input.tenantId, input.recipient, renderPush(input, subject))
    if (result.sent === 0) {
      throw new Error(result.devices === 0 ? 'No push devices registered' : 'Push was not delivered to any device')
    }
    console.log(`[notification] push → user ${input.recipient} (${result.sent} device(s)) | ${input.templateKey}`)
    return { provider: 'push', subject, body }
  }

  if (input.channel === 'EMAIL' && process.env.SENDGRID_API_KEY?.trim()) {
    const attachments = await emailAttachments(input)
    await sendViaSendGrid(input.recipient, subject, body, attachments)
    console.log(
      `[notification] sendgrid → ${input.recipient} | ${input.templateKey}${attachments.length ? ` | ${attachments.map((a) => a.filename).join(', ')}` : ''}`,
    )
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

  // Printing the message is a development convenience only. Bodies carry password-reset, invite
  // and verification links, so in production anyone who can read the logs could use them. With no
  // real provider there, refuse instead: callers record the failure, and nothing secret is logged.
  if (process.env.NODE_ENV === 'production') {
    console.error(`[notification] no ${input.channel} provider configured; ${input.templateKey} not sent`)
    throw new Error(`No ${input.channel} provider configured`)
  }

  const line = `[notification] ${input.channel} → ${input.recipient} | ${input.templateKey}`
  console.log(line)
  console.log(`  subject: ${subject}`)
  console.log(`  body: ${body}`)
  for (const a of input.channel === 'EMAIL' ? await emailAttachments(input) : []) {
    console.log(`  attachment: ${a.filename} (${Math.round((a.content.length * 3) / 4 / 1024)} KB)`)
  }
  return { provider: 'console', subject, body }
}
