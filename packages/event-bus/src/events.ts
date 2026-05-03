// All system events — single source of truth.

export enum EventType {
  // Inventory
  STOCK_RECEIVED = 'inventory.stock_received',
  STOCK_ADJUSTED = 'inventory.stock_adjusted',
  STOCK_TRANSFERRED = 'inventory.stock_transferred',
  STOCK_RESERVED = 'inventory.stock_reserved',
  STOCK_RELEASED = 'inventory.stock_released',
  STOCK_LEVEL_LOW = 'inventory.stock_level_low',
  STOCK_DEPLETED = 'inventory.stock_depleted',

  // Orders
  ORDER_CREATED = 'order.created',
  ORDER_CONFIRMED = 'order.confirmed',
  ORDER_CANCELLED = 'order.cancelled',
  ORDER_FULFILLED = 'order.fulfilled',
  ORDER_SHIPPED = 'order.shipped',
  ORDER_DELIVERED = 'order.delivered',
  ORDER_RETURNED = 'order.returned',

  // WMS
  PICK_LIST_CREATED = 'wms.pick_list_created',
  PICK_LIST_COMPLETED = 'wms.pick_list_completed',
  SHIPMENT_PACKED = 'wms.shipment_packed',
  SHIPMENT_DISPATCHED = 'wms.shipment_dispatched',
  RECEIVING_COMPLETED = 'wms.receiving_completed',

  // Compliance
  MSA_REPORT_GENERATED = 'compliance.msa_report_generated',
  MSA_REPORT_SUBMITTED = 'compliance.msa_report_submitted',
  MSA_EXCEPTION_RAISED = 'compliance.msa_exception_raised',
  BATCH_CREATED = 'compliance.batch_created',
  BATCH_EXPIRY_ALERT = 'compliance.batch_expiry_alert',
  BATCH_EXPIRED = 'compliance.batch_expired',
  BATCH_RECALLED = 'compliance.batch_recalled',
  TAX_LIABILITY_RECORDED = 'compliance.tax_liability_recorded',

  // Finance
  PAYMENT_INITIATED = 'finance.payment_initiated',
  PAYMENT_CAPTURED = 'finance.payment_captured',
  PAYMENT_FAILED = 'finance.payment_failed',
  PAYMENT_REFUNDED = 'finance.payment_refunded',
  LEDGER_ENTRY_CREATED = 'finance.ledger_entry_created',
  INVOICE_GENERATED = 'finance.invoice_generated',

  // Purchasing
  PO_CREATED = 'purchasing.po_created',
  PO_APPROVED = 'purchasing.po_approved',
  PO_RECEIVED = 'purchasing.po_received',
  PO_CANCELLED = 'purchasing.po_cancelled',

  // CRM
  CUSTOMER_CREATED = 'crm.customer_created',
  LEAD_CONVERTED = 'crm.lead_converted',

  // Dispatch
  ROUTE_OPTIMIZED = 'dispatch.route_optimized',
  DRIVER_ASSIGNED = 'dispatch.driver_assigned',
  DELIVERY_COMPLETED = 'dispatch.delivery_completed',
  DELIVERY_FAILED = 'dispatch.delivery_failed',
}

export interface ReceivingCompletedPayload {
  sessionId: string
  warehouseId: string
  poId?: string | null
  itemCount: number
  hasDiscrepancy: boolean
}

export interface BaseEvent<T = unknown> {
  id: string
  type: EventType
  tenantId: string
  timestamp: Date
  correlationId: string
  causationId?: string
  version: number
  payload: T
  metadata?: Record<string, unknown>
}

// ---------- Inventory payloads ----------
export interface StockReceivedPayload {
  skuId: string
  warehouseId: string
  locationId: string
  batchId?: string
  quantity: number
  unitCost: number
  supplierId: string
  poId?: string
  receivedBy: string
}

export interface StockReservedPayload {
  reservationId: string
  skuId: string
  warehouseId: string
  quantity: number
  orderId: string
}

export interface StockReleasedPayload {
  reservationId: string
  skuId: string
}

export interface StockLevelLowPayload {
  skuId: string
  warehouseId: string
  quantityAvailable: number
  reorderPoint: number
  suggestedReorderQty: number
}

// ---------- Orders payloads ----------
export interface OrderCreatedPayload {
  orderId: string
  customerId: string
  lineItems: Array<{
    skuId: string
    quantity: number
    unitPrice: number
    warehouseId: string
  }>
  totalAmount: number
  salesRepId?: string
  channel: 'POS' | 'B2B_PORTAL' | 'SALES_REP' | 'API'
}

export interface OrderConfirmedPayload {
  orderId: string
  paymentIntentId?: string
}

export interface OrderCancelledPayload {
  orderId: string
  reason: string
}

// ---------- Compliance payloads ----------
export interface MSAReportGeneratedPayload {
  reportId: string
  weekEnding: Date
  manufacturerDid: string
  manufacturerName: string
  filePath: string
  totalTransactions: number
  netPurchases: number
  fileHash: string
}

export interface MSAReportSubmittedPayload {
  reportId: string
  confirmationId: string
}

export interface MSAExceptionPayload {
  reportId: string
  error: string
  requiresManualReview: boolean
}

export interface BatchExpiryAlertPayload {
  batchId: string
  skuId: string
  warehouseId: string
  expiryDate: Date
  daysUntilExpiry: number
  quantityAtRisk: number
}

// ---------- Finance payloads ----------
export interface LedgerEntryCreatedPayload {
  entryGroupId: string
  orderId?: string
  amount: number
  taxAmount?: number
}

export interface PaymentCapturedPayload {
  paymentIntentId: string
  orderId: string
  amount: number
  currency: string
}
