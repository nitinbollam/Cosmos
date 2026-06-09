import { randomUUID } from 'node:crypto'
import { EdiDirection, EdiDocStatus, EdiDocType } from '@/generated/prisma-tenant'
import { tenantDb, orderDb } from './db'
import * as crm from './crm'
import * as inv from './inventory'
import * as orders from './orders'
import { ApiError } from './session'

export type Edi850Payload = {
  partnerCode: string
  purchaseOrderNumber: string
  customerCode?: string
  customerId?: string
  paymentMethod?: string
  shipTo?: Record<string, unknown>
  lines: Array<{ skuCode: string; quantity: number; unitPrice: number }>
}

export function listTradingPartners(tenantId: string) {
  return tenantDb.ediTradingPartner.findMany({
    where: { tenantId, isActive: true },
    orderBy: { code: 'asc' },
  })
}

export async function createTradingPartner(
  tenantId: string,
  dto: {
    code: string
    name: string
    isaId?: string
    inboundEnabled?: boolean
    outboundEnabled?: boolean
    autoCreateOrders?: boolean
  },
) {
  return tenantDb.ediTradingPartner.create({
    data: {
      tenantId,
      code: dto.code.trim().toUpperCase(),
      name: dto.name.trim(),
      isaId: dto.isaId?.trim() || null,
      inboundEnabled: dto.inboundEnabled ?? true,
      outboundEnabled: dto.outboundEnabled ?? true,
      autoCreateOrders: dto.autoCreateOrders ?? true,
    },
  })
}

export async function updateTradingPartner(
  tenantId: string,
  id: string,
  patch: Partial<{
    name: string
    isaId: string | null
    inboundEnabled: boolean
    outboundEnabled: boolean
    autoCreateOrders: boolean
    isActive: boolean
  }>,
) {
  const row = await tenantDb.ediTradingPartner.findFirst({ where: { id, tenantId } })
  if (!row) throw new ApiError(404, 'Trading partner not found')
  return tenantDb.ediTradingPartner.update({ where: { id }, data: patch })
}

export function listEdiDocuments(tenantId: string, limit = 50) {
  return tenantDb.ediDocument.findMany({
    where: { tenantId },
    include: { partner: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export async function ingest850(tenantId: string, payload: Edi850Payload) {
  const partner = await tenantDb.ediTradingPartner.findFirst({
    where: { tenantId, code: payload.partnerCode.trim().toUpperCase(), isActive: true },
  })
  if (!partner) throw new ApiError(400, `Unknown trading partner: ${payload.partnerCode}`)
  if (!partner.inboundEnabled) throw new ApiError(400, 'Partner inbound EDI is disabled')

  const doc = await tenantDb.ediDocument.create({
    data: {
      id: randomUUID(),
      tenantId,
      partnerId: partner.id,
      docType: EdiDocType.PO_850,
      direction: EdiDirection.INBOUND,
      status: EdiDocStatus.RECEIVED,
      controlNumber: payload.purchaseOrderNumber,
      payload: payload as object,
    },
  })

  if (partner.autoCreateOrders) {
    try {
      const orderId = await process850Document(tenantId, doc.id)
      return { documentId: doc.id, status: 'PROCESSED' as const, orderId }
    } catch (err) {
      const message = err instanceof Error ? err.message : '850 processing failed'
      await tenantDb.ediDocument.update({
        where: { id: doc.id },
        data: { status: EdiDocStatus.FAILED, errorMessage: message },
      })
      throw new ApiError(400, message)
    }
  }

  return { documentId: doc.id, status: 'RECEIVED' as const }
}

export async function process850Document(tenantId: string, documentId: string) {
  const doc = await tenantDb.ediDocument.findFirst({
    where: { id: documentId, tenantId, docType: EdiDocType.PO_850 },
  })
  if (!doc) throw new ApiError(404, 'EDI 850 document not found')

  const payload = doc.payload as Edi850Payload
  if (!payload.lines?.length) throw new ApiError(400, '850 has no lines')

  let customerId = payload.customerId
  if (!customerId && payload.customerCode) {
    const customer = await crm.findCustomerByExternalRef(tenantId, payload.customerCode.trim())
    if (!customer) throw new ApiError(400, `Customer not found for code ${payload.customerCode}`)
    customerId = customer.id
  }
  if (!customerId) throw new ApiError(400, 'customerId or customerCode required on 850')

  const warehouses = await inv.listWarehouses(tenantId)
  const warehouse = warehouses.find((w) => w.isDefault) ?? warehouses[0]
  if (!warehouse) throw new ApiError(400, 'No warehouse configured')

  const lineItems = []
  for (const line of payload.lines) {
    const sku = await inv.findSkuByCode(tenantId, line.skuCode.trim())
    lineItems.push({
      skuId: sku.id,
      warehouseId: warehouse.id,
      quantity: Math.floor(line.quantity),
      unitPrice: line.unitPrice,
    })
  }

  const order = await orders.createOrder(tenantId, {
    customerId,
    channel: 'EDI',
    paymentMethod: payload.paymentMethod ?? 'NET_TERMS',
    notes: `EDI 850 ${payload.purchaseOrderNumber}`,
    shippingAddress: payload.shipTo,
    lineItems,
  })

  await tenantDb.ediDocument.update({
    where: { id: documentId },
    data: {
      status: EdiDocStatus.PROCESSED,
      referenceType: 'Order',
      referenceId: order.id,
      processedAt: new Date(),
      errorMessage: null,
    },
  })

  return order.id
}

export async function generate810ForInvoice(tenantId: string, invoiceId: string) {
  const invoice = await orderDb.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { order: { include: { lineItems: true } } },
  })
  if (!invoice?.order) throw new ApiError(404, 'Invoice not found')

  const payload = {
    invoiceNumber: invoice.invoiceNumber,
    orderId: invoice.orderId,
    customerId: invoice.order.customerId,
    issuedAt: invoice.issuedAt.toISOString(),
    totalAmount: Number(invoice.totalAmount),
    amountPaid: Number(invoice.amountPaid ?? 0),
    lines: invoice.order.lineItems.map((li) => ({
      skuId: li.skuId,
      quantity: li.quantity,
      unitPrice: Number(li.unitPrice),
    })),
  }

  const doc = await tenantDb.ediDocument.create({
    data: {
      id: randomUUID(),
      tenantId,
      docType: EdiDocType.INVOICE_810,
      direction: EdiDirection.OUTBOUND,
      status: EdiDocStatus.SENT,
      controlNumber: invoice.invoiceNumber,
      payload,
      referenceType: 'Invoice',
      referenceId: invoice.id,
      processedAt: new Date(),
    },
  })

  return { documentId: doc.id, payload }
}

export async function generate856ForShipment(tenantId: string, orderId: string, shipmentNo: number) {
  const shipment = await orderDb.orderShipment.findFirst({
    where: { tenantId, orderId, shipmentNo },
  })
  if (!shipment) throw new ApiError(404, 'Shipment not found')

  const payload = {
    orderId,
    shipmentNo,
    carrier: shipment.carrier,
    trackingNumber: shipment.trackingNumber,
    shippedAt: shipment.shippedAt?.toISOString() ?? null,
    lineItems: shipment.lineItems,
  }

  const doc = await tenantDb.ediDocument.create({
    data: {
      id: randomUUID(),
      tenantId,
      docType: EdiDocType.ASN_856,
      direction: EdiDirection.OUTBOUND,
      status: EdiDocStatus.SENT,
      controlNumber: `${orderId.slice(-8)}-${shipmentNo}`,
      payload: payload as object,
      referenceType: 'OrderShipment',
      referenceId: shipment.id,
      processedAt: new Date(),
    },
  })

  return { documentId: doc.id, payload }
}
