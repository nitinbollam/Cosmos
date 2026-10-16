import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, afterEach, before, test } from 'node:test'
import { crmDb, orderDb, tenantDb } from './db'
import { deliverNotification } from './notification-provider'

const tenantId = `t-${randomUUID()}`
let invoiceId = ''
const invoiceNumber = `INV-${randomUUID().slice(0, 6).toUpperCase()}`

type SendGridBody = {
  subject: string
  attachments?: Array<{ filename: string; type: string; content: string; disposition: string }>
}
const realFetch = globalThis.fetch
const prevKey = process.env.SENDGRID_API_KEY

/** Capture what would be posted to SendGrid instead of sending it. */
function captureSendGrid() {
  const sent: SendGridBody[] = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    assert.match(String(url), /api\.sendgrid\.com/)
    sent.push(JSON.parse(String(init?.body)))
    return new Response(null, { status: 202 })
  }) as typeof fetch
  return sent
}

before(async () => {
  process.env.SENDGRID_API_KEY = 'SG.test-key'
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `inv-${tenantId.slice(-8)}`, displayName: 'Acme Distribution', settings: {}, metadata: {} },
  })
  const customer = await crmDb.customer.create({ data: { tenantId, name: 'Buyer Co', email: 'ap@buyer.test' } })
  const order = await orderDb.order.create({
    data: { tenantId, customerId: customer.id, channel: 'B2B_PORTAL', totalAmount: 120, paymentMethod: 'NET_TERMS', status: 'SHIPPED' },
  })
  invoiceId = (
    await orderDb.invoice.create({
      data: { tenantId, orderId: order.id, invoiceNumber, customerId: customer.id, subtotal: 120, taxAmount: 0, totalAmount: 120 },
    })
  ).id
})

afterEach(() => {
  globalThis.fetch = realFetch
})

after(async () => {
  if (prevKey === undefined) delete process.env.SENDGRID_API_KEY
  else process.env.SENDGRID_API_KEY = prevKey
  await orderDb.invoice.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
})

const invoiceEmail = (id: string) => ({
  tenantId,
  channel: 'EMAIL' as const,
  recipient: 'ap@buyer.test',
  templateKey: 'invoice.issued',
  payload: { invoiceId: id, invoiceNumber, total: '120.00' },
})

test('an invoice email carries the invoice as a PDF attachment', async () => {
  const sent = captureSendGrid()
  const res = await deliverNotification(invoiceEmail(invoiceId))
  assert.equal(res.provider, 'sendgrid')
  assert.equal(sent.length, 1)
  const [attachment] = sent[0]!.attachments ?? []
  assert.ok(attachment, 'has an attachment')
  assert.equal(attachment.filename, `${invoiceNumber}.pdf`)
  assert.equal(attachment.type, 'application/pdf')
  assert.equal(attachment.disposition, 'attachment')
  const pdf = Buffer.from(attachment.content, 'base64')
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  assert.ok(pdf.length > 500, `a real document (${pdf.length} bytes)`)
})

test('if the PDF cannot be built, the email still goes out without it', async () => {
  const sent = captureSendGrid()
  const res = await deliverNotification(invoiceEmail('no-such-invoice'))
  assert.equal(res.provider, 'sendgrid')
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.attachments, undefined)
})

test('other emails have no attachments', async () => {
  const sent = captureSendGrid()
  await deliverNotification({
    tenantId,
    channel: 'EMAIL',
    recipient: 'ap@buyer.test',
    templateKey: 'payment.received',
    payload: { amount: '10.00', invoiceId },
  })
  assert.equal(sent[0]!.attachments, undefined)
})

test('a hand-sent invoice email to someone other than the customer gets no PDF', async () => {
  const sent = captureSendGrid()
  await deliverNotification({ ...invoiceEmail(invoiceId), recipient: 'someone@elsewhere.test' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.attachments, undefined)
})

test('the customer match ignores letter case and spaces', async () => {
  const sent = captureSendGrid()
  await deliverNotification({ ...invoiceEmail(invoiceId), recipient: ' AP@Buyer.Test ' })
  assert.equal(sent[0]!.attachments?.length, 1)
})
