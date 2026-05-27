import * as tenant from './tenant'
import * as users from './users'
import * as inv from './inventory'
import * as crm from './crm'
import * as orders from './orders'
import * as invoices from './invoices'
import * as orderOrchestration from './order-orchestration'
import * as quotes from './quotes'
import * as wmsFulfillment from './wms-fulfillment'
import * as wmsReceiving from './wms-receiving'
import * as wmsCycleCount from './wms-cycle-count'
import * as dispatch from './dispatch'
import * as purchasing from './purchasing'
import * as payments from './payments'
import * as paymentIdempotency from './payment-idempotency'
import * as complianceMsa from './compliance-msa'
import * as complianceTax from './compliance-tax'
import * as notifications from './notifications'
import * as ledger from './ledger'
import * as analytics from './analytics'
import * as webhooks from './webhooks'
import { getAuthProfile, isPortalBuyer, requirePortalCustomerId } from './buyer-context'
import { getTenantTaxSettings } from './tenant-tax'
import { ApiError, requireSession, requireRole, assertRole, ADMIN_ROLES, OPS_ROLES, DRIVER_ROLES, toJsonError } from './session'

/** Returns Response if handled; null → 404 from catch-all route. */
export async function handleNativeApi(method: string, path: string[], req: Request): Promise<Response | null> {
  const m = method.toUpperCase()
  const seg = path

  try {
    if (seg[0] === 'tenants') return await routeTenants(m, seg, req)
    if (seg[0] === 'users') return await routeUsers(m, seg, req)
    if (seg[0] === 'skus') return await routeSkus(m, seg, req)
    if (seg[0] === 'warehouses') return await routeWarehouses(m, seg, req)
    if (seg[0] === 'inventory') return await routeInventory(m, seg, req)
    if (seg[0] === 'orders') return await routeOrders(m, seg, req)
    if (seg[0] === 'invoices') return await routeInvoices(m, seg, req)
    if (seg[0] === 'customers') return await routeCustomers(m, seg, req)
    if (seg[0] === 'leads') return await routeLeads(m, seg, req)
    if (seg[0] === 'activities') return await routeActivities(m, seg, req)
    if (seg[0] === 'quotes') return await routeQuotes(m, seg, req)
    if (seg[0] === 'fulfillment') return await routeFulfillment(m, seg, req)
    if (seg[0] === 'wms') return await routeWms(m, seg, req)
    if (seg[0] === 'routes') return await routeRoutes(m, seg, req)
    if (seg[0] === 'dispatch') return await routeDispatchMobile(m, seg, req)
    if (seg[0] === 'purchase-orders') return await routePurchaseOrders(m, seg, req)
    if (seg[0] === 'suppliers') return await routeSuppliers(m, seg, req)
    if (seg[0] === 'payments') return await routePayments(m, seg, req)
    if (seg[0] === 'msa') return await routeMsa(m, seg, req)
    if (seg[0] === 'tax') return await routeTax(m, seg, req)
    if (seg[0] === 'notifications') return await routeNotifications(m, seg, req)
    if (seg[0] === 'journal-entries') return await routeJournalEntries(m, seg, req)
    if (seg[0] === 'chart-accounts') return await routeChartAccounts(m, seg, req)
    if (seg[0] === 'reports') return await routeReports(m, seg, req)
    if (seg[0] === 'kpi') return await routeKpi(m, seg, req)
    if (seg[0] === 'analytics') return await routeAnalytics(m, seg, req)
    if (seg[0] === 'internal') return await routeInternal(m, seg, req)
    if (seg[0] === 'webhooks') return await routeWebhooks(m, seg, req)
    return null
  } catch (e) {
    return toJsonError(e)
  }
}

async function routeTenants(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const tenantId = session.tenantId

  if (seg[1] === 'me' && seg.length === 2 && method === 'GET') {
    return Response.json(await tenant.findTenantById(tenantId))
  }
  if (seg[1] === 'me' && seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(await tenant.patchTenant(tenantId, body as Parameters<typeof tenant.patchTenant>[1]))
  }
  if (seg[1] === 'me' && seg[2] === 'invites' && seg.length === 3) {
    if (method === 'GET') return Response.json(await tenant.listPendingInvites(tenantId))
    if (method === 'POST') {
      const body = (await req.json()) as { email?: string; role?: string }
      if (!body.email) throw new ApiError(400, 'email required')
      return Response.json(await tenant.createInvite(tenantId, { email: body.email, role: body.role }))
    }
  }
  if (seg[1] === 'me' && seg[2] === 'invites' && seg.length === 4 && method === 'DELETE') {
    await tenant.revokeInvite(tenantId, seg[3])
    return Response.json({ ok: true })
  }
  if (seg[1] === 'me' && seg[2] === 'upgrade' && method === 'POST') {
    const body = (await req.json()) as { plan?: 'STARTER' | 'GROWTH' | 'ENTERPRISE' }
    if (!body.plan) throw new ApiError(400, 'plan required')
    return Response.json(await tenant.updateTenantPlan(tenantId, body.plan))
  }
  if (seg[1] === 'me' && seg[2] === 'plan' && method === 'PATCH') {
    const body = (await req.json()) as { plan?: 'STARTER' | 'GROWTH' | 'ENTERPRISE' }
    if (!body.plan) throw new ApiError(400, 'plan required')
    return Response.json(await tenant.updateTenantPlan(tenantId, body.plan))
  }
  if (seg[1] === 'me' && seg[2] === 'onboarding-steps' && seg.length === 4 && method === 'PATCH') {
    const body = (await req.json()) as { completed?: boolean; payload?: Record<string, unknown> }
    return Response.json(await tenant.patchOnboardingStep(tenantId, seg[3], body))
  }
  throw new ApiError(404, 'Tenant route not found')
}

async function routeUsers(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const url = new URL(req.url)

  if (seg.length === 1 && method === 'GET') {
    const page = +(url.searchParams.get('page') ?? 1)
    const pageSize = +(url.searchParams.get('pageSize') ?? 20)
    return Response.json(await users.listUsers(session.tenantId, page, pageSize))
  }
  if (seg.length === 2 && method === 'DELETE') {
    return Response.json(await users.deactivateUser(session.tenantId, seg[1]))
  }
  throw new ApiError(404, 'User route not found')
}

async function routeSkus(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const url = new URL(req.url)

  if (seg[1] === 'categories' && method === 'GET') {
    return Response.json(await inv.distinctCategories(session.tenantId))
  }
  if (seg[1] === 'lookup' && seg[2] === 'by-code' && method === 'GET') {
    const code = url.searchParams.get('code')
    if (!code) throw new ApiError(400, 'code query required')
    return Response.json(await inv.findSkuByCode(session.tenantId, code))
  }
  if (seg[1] === 'lookup' && seg[2] === 'scan-value' && method === 'GET') {
    const value = url.searchParams.get('value')
    if (!value) throw new ApiError(400, 'value query required')
    return Response.json(await inv.findSkuByScanValue(session.tenantId, value))
  }
  if (seg[1] === 'import' && method === 'POST') {
    const body = (await req.json()) as { rows?: inv.CreateSkuInput[] }
    return Response.json(await inv.importSkus(session.tenantId, body.rows ?? []))
  }
  if (seg.length === 1 && method === 'GET') {
    const page = +(url.searchParams.get('page') ?? 1)
    const pageSize = +(url.searchParams.get('pageSize') ?? 50)
    const term = (url.searchParams.get('search') ?? url.searchParams.get('q'))?.trim() || undefined
    return Response.json(
      await inv.listSkus(session.tenantId, page, pageSize, term, {
        category: url.searchParams.get('category') ?? undefined,
        warehouseId: url.searchParams.get('warehouseId') ?? undefined,
        inStockOnly: url.searchParams.get('inStock') === 'true',
      }),
    )
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as inv.CreateSkuInput
    return Response.json(await inv.createSku(session.tenantId, body))
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await inv.findSkuById(session.tenantId, seg[1]))
  }
  if (seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as Partial<inv.CreateSkuInput> & { isActive?: boolean }
    return Response.json(await inv.updateSku(session.tenantId, seg[1], body))
  }
  throw new ApiError(404, 'SKU route not found')
}

async function routeWarehouses(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await inv.listWarehouses(session.tenantId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof inv.createWarehouse>[1]
    return Response.json(await inv.createWarehouse(session.tenantId, body))
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await inv.findWarehouseById(session.tenantId, seg[1]))
  }
  if (seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as { isDefault?: boolean }
    if (body.isDefault) return Response.json(await inv.setDefaultWarehouse(session.tenantId, seg[1]))
    return Response.json(await inv.findWarehouseById(session.tenantId, seg[1]))
  }
  throw new ApiError(404, 'Warehouse route not found')
}

async function routeInventory(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const url = new URL(req.url)

  if (seg[1] === 'ledger' && method === 'GET') {
    const skuId = url.searchParams.get('skuId')
    if (!skuId) throw new ApiError(400, 'skuId query required')
    const limit = +(url.searchParams.get('limit') ?? 100)
    return Response.json(await inv.ledgerForSku(session.tenantId, skuId, limit))
  }
  if (seg[1] === 'adjust' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof inv.adjustStock>[1]
    return Response.json(await inv.adjustStock(session.tenantId, body, session.userId))
  }
  if (seg[1] === 'receive' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof inv.receiveStock>[1]
    return Response.json(await inv.receiveStock(session.tenantId, body, session.userId))
  }
  if (seg[1] === 'transfer' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof inv.transferStock>[1]
    return Response.json(await inv.transferStock(session.tenantId, body, session.userId))
  }
  if (seg[1] === 'alerts' && method === 'GET') {
    return Response.json(await inv.lowStockAlerts(session.tenantId))
  }
  if (seg[1] === 'levels' && seg.length === 2 && method === 'GET') {
    return Response.json(
      await inv.getStockLevels(session.tenantId, {
        skuId: url.searchParams.get('skuId') ?? undefined,
        warehouseId: url.searchParams.get('warehouseId') ?? undefined,
      }),
    )
  }
  if (seg[1] === 'levels' && seg[2] === 'ensure' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof inv.ensureStockLevel>[1]
    return Response.json(await inv.ensureStockLevel(session.tenantId, body))
  }
  if (seg[1] === 'levels' && seg.length === 3 && method === 'PATCH') {
    const body = (await req.json()) as Parameters<typeof inv.patchStockLevel>[2]
    return Response.json(await inv.patchStockLevel(session.tenantId, seg[2], body))
  }
  if (seg[1] === 'stock' && seg[2] === 'reserve' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof inv.reserveStock>[1]
    const reservationId = await inv.reserveStock(session.tenantId, body)
    return Response.json({ reservationId })
  }
  if (seg[1] === 'stock' && seg[2] === 'release' && method === 'POST') {
    const body = (await req.json()) as { reservationId: string }
    await inv.releaseReservation(session.tenantId, body.reservationId)
    return Response.json({ released: true })
  }
  throw new ApiError(404, 'Inventory route not found')
}

async function routeOrders(method: string, seg: string[], req: Request): Promise<Response> {
  const url = new URL(req.url)
  const adminAction =
    seg.length === 3 &&
    method === 'POST' &&
    (seg[2] === 'confirm' ||
      seg[2] === 'fulfill' ||
      seg[2] === 'cancel' ||
      seg[2] === 'payments' ||
      seg[2] === 'returns')
  const session = adminAction ? await requireRole(req, ADMIN_ROLES) : await requireSession(req)
  const buyerCustomerId = isPortalBuyer(session.role)
    ? await requirePortalCustomerId(session)
    : undefined
  const buyerOpts = buyerCustomerId ? { buyerCustomerId } : undefined

  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as orders.CreateOrderInput
    const order = await orders.createOrder(session.tenantId, body, buyerOpts)
    return Response.json(order, { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await orders.findOrderById(session.tenantId, seg[1], buyerOpts))
  }
  if (seg.length === 1 && method === 'GET') {
    return Response.json(
      await orders.listOrders(
        session.tenantId,
        +(url.searchParams.get('page') ?? 1),
        +(url.searchParams.get('pageSize') ?? 20),
        {
          status: url.searchParams.get('status') ?? undefined,
          channel: url.searchParams.get('channel') ?? undefined,
          search: url.searchParams.get('search') ?? url.searchParams.get('q') ?? undefined,
          fromIso: url.searchParams.get('from') ?? undefined,
          toIso: url.searchParams.get('to') ?? undefined,
          customerId: buyerCustomerId ? undefined : url.searchParams.get('customerId') ?? undefined,
        },
        buyerOpts,
      ),
    )
  }
  if (seg.length === 3 && seg[2] === 'confirm' && method === 'POST') {
    return Response.json(await orders.confirmOrder(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'fulfill' && method === 'POST') {
    return Response.json(await orders.fulfillOrder(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'cancel' && method === 'POST') {
    const body = (await req.json()) as { reason?: string }
    if (!body.reason) throw new ApiError(400, 'reason is required')
    return Response.json(await orders.cancelOrder(session.tenantId, seg[1], body.reason))
  }
  if (seg.length === 3 && seg[2] === 'invoice' && method === 'GET') {
    return Response.json(await invoices.getInvoiceByOrderId(session.tenantId, seg[1], buyerOpts))
  }
  if (seg.length === 3 && seg[2] === 'returns' && method === 'POST') {
    const body = (await req.json()) as Omit<invoices.ApplyCreditMemoInput, 'orderId'>
    return Response.json(
      await invoices.applyCreditMemo(session.tenantId, { ...body, orderId: seg[1] }, session.userId),
    )
  }
  if (seg.length === 3 && seg[2] === 'payments' && method === 'POST') {
    const body = (await req.json()) as { amount: number; method: string; reference?: string }
    return Response.json(await orders.recordOrderPayment(session.tenantId, seg[1], body))
  }
  throw new ApiError(404, 'Order route not found')
}

async function routeCustomers(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg[1] === 'me' && seg.length === 2 && method === 'GET') {
    const profile = await getAuthProfile(session)
    if (!profile.customerId) throw new ApiError(404, 'No customer linked to this account')
    return Response.json(await crm.getCustomer(session.tenantId, profile.customerId))
  }

  if (isPortalBuyer(session.role)) {
    throw new ApiError(403, 'Forbidden')
  }

  if (seg[1] === 'lookup' && method === 'GET') {
    const ref = new URL(req.url).searchParams.get('externalRef')
    if (!ref) throw new ApiError(400, 'externalRef query required')
    const row = await crm.findCustomerByExternalRef(session.tenantId, ref)
    if (!row) throw new ApiError(404, 'Customer not found')
    return Response.json(row)
  }
  if (seg[1] === 'import' && method === 'POST') {
    const body = (await req.json()) as { rows?: Record<string, unknown>[] }
    return Response.json(await crm.importCustomers(session.tenantId, body.rows ?? []))
  }
  if (seg.length === 1 && method === 'GET') {
    return Response.json(await crm.listCustomers(session.tenantId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(await crm.createCustomer(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await crm.getCustomer(session.tenantId, seg[1]))
  }
  if (seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(await crm.patchCustomer(session.tenantId, seg[1], body))
  }
  throw new ApiError(404, 'Customer route not found')
}

async function routeLeads(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg[1] === 'import' && method === 'POST') {
    const body = (await req.json()) as { rows?: Record<string, unknown>[] }
    return Response.json(await crm.importLeads(session.tenantId, body.rows ?? []))
  }
  if (seg.length === 1 && method === 'GET') {
    return Response.json(await crm.listLeads(session.tenantId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(await crm.createLead(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await crm.getLead(session.tenantId, seg[1]))
  }
  if (seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(await crm.patchLead(session.tenantId, seg[1], body))
  }
  if (seg.length === 3 && seg[2] === 'convert' && method === 'POST') {
    const body = (await req.json()) as { customerName?: string }
    if (!body.customerName) throw new ApiError(400, 'customerName required')
    return Response.json(await crm.convertLead(session.tenantId, seg[1], body.customerName))
  }
  throw new ApiError(404, 'Lead route not found')
}

async function routeActivities(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const url = new URL(req.url)

  if (seg.length === 1 && method === 'GET') {
    return Response.json(
      await crm.listActivities(
        session.tenantId,
        url.searchParams.get('customerId') ?? undefined,
        url.searchParams.get('leadId') ?? undefined,
      ),
    )
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(await crm.createActivity(session.tenantId, body), { status: 201 })
  }
  throw new ApiError(404, 'Activity route not found')
}

async function routeInvoices(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const url = new URL(req.url)
  const buyerCustomerId = isPortalBuyer(session.role)
    ? await requirePortalCustomerId(session)
    : undefined
  const buyerOpts = buyerCustomerId ? { buyerCustomerId } : undefined

  if (seg.length === 1 && method === 'GET') {
    return Response.json(
      await invoices.listInvoices(
        session.tenantId,
        +(url.searchParams.get('page') ?? 1),
        +(url.searchParams.get('pageSize') ?? 50),
        {
          status: url.searchParams.get('status') ?? undefined,
          customerId: buyerCustomerId ? undefined : url.searchParams.get('customerId') ?? undefined,
        },
        buyerOpts,
      ),
    )
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await invoices.getInvoice(session.tenantId, seg[1], buyerOpts))
  }
  throw new ApiError(404, 'Invoice route not found')
}

async function routeQuotes(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const url = new URL(req.url)
  const buyerCustomerId = isPortalBuyer(session.role)
    ? await requirePortalCustomerId(session)
    : undefined
  const buyerOpts = buyerCustomerId ? { buyerCustomerId } : undefined

  if (seg.length === 1 && method === 'GET') {
    const status = url.searchParams.get('status') ?? undefined
    return Response.json(await quotes.listQuotes(session.tenantId, status, buyerOpts))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof quotes.createQuote>[1]
    return Response.json(await quotes.createQuote(session.tenantId, body, buyerOpts), { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await quotes.getQuote(session.tenantId, seg[1], buyerOpts))
  }
  if (seg.length === 3 && seg[2] === 'submit' && method === 'POST') {
    const byEmail = session.email
      ? await crm.findCustomerByEmail(session.tenantId, session.email)
      : null
    return Response.json(
      await quotes.submitQuote(session.tenantId, seg[1], byEmail?.id, buyerOpts),
    )
  }
  throw new ApiError(404, 'Quote route not found')
}

async function routePurchaseOrders(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = isRead ? await requireSession(req) : await requireRole(req, ADMIN_ROLES)
  const url = new URL(req.url)

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await purchasing.listPurchaseOrders(session.tenantId, url.searchParams.get('status') ?? undefined))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as purchasing.CreatePurchaseOrderInput
    return Response.json(await purchasing.createPurchaseOrder(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await purchasing.getPurchaseOrder(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'submit' && method === 'POST') {
    return Response.json(await purchasing.submitPurchaseOrder(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'cancel' && method === 'POST') {
    return Response.json(await purchasing.cancelPurchaseOrder(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'receive' && method === 'POST') {
    const body = (await req.json()) as purchasing.ReceiveGoodsInput
    return Response.json(await purchasing.receiveGoods(session.tenantId, seg[1], body, session.userId))
  }
  if (seg.length === 3 && seg[2] === 'payments' && method === 'POST') {
    const body = (await req.json()) as purchasing.RecordPoPaymentInput
    return Response.json(await purchasing.recordPurchaseOrderPayment(session.tenantId, seg[1], body))
  }

  throw new ApiError(404, 'Purchase order route not found')
}

function requireIdempotencyKey(req: Request): string {
  const key = req.headers.get('idempotency-key')?.trim()
  if (!key) throw new ApiError(400, 'Idempotency-Key header is required for payment mutations.')
  return key
}

async function routePayments(method: string, seg: string[], req: Request): Promise<Response> {
  if (seg[1] === 'stripe' && seg[2] === 'status' && method === 'GET') {
    return Response.json(payments.stripeIntegrationStatus())
  }
  if (seg[1] === 'webhook' && seg[2] === 'stripe' && method === 'POST') {
    const sig = req.headers.get('stripe-signature') ?? ''
    const raw = Buffer.from(await req.arrayBuffer())
    const result = payments.handleStripeWebhook(raw, sig)
    return Response.json(result)
  }

  const session = await requireSession(req)

  if (seg.length === 2 && seg[1] === 'authorize' && method === 'POST') {
    const key = requireIdempotencyKey(req)
    const cached = await paymentIdempotency.getIdempotentResponse(key)
    if (cached) return Response.json(cached.body, { status: cached.status })
    const body = (await req.json()) as payments.AuthorizeInput
    const result = await payments.authorize(session.tenantId, body)
    await paymentIdempotency.setIdempotentResponse(key, session.tenantId, 200, result)
    return Response.json(result)
  }
  if (seg.length === 2 && seg[1] === 'capture' && method === 'POST') {
    requireIdempotencyKey(req)
    const body = (await req.json()) as { paymentIntentId: string; correlationId: string }
    return Response.json(await payments.capture(session.tenantId, body.paymentIntentId, body.correlationId))
  }
  if (seg.length === 2 && seg[1] === 'void' && method === 'POST') {
    requireIdempotencyKey(req)
    const body = (await req.json()) as { paymentIntentId: string; correlationId: string }
    return Response.json(await payments.voidIntent(session.tenantId, body.paymentIntentId, body.correlationId))
  }
  if (seg.length === 2 && seg[1] === 'refund' && method === 'POST') {
    requireIdempotencyKey(req)
    const body = (await req.json()) as { paymentIntentId: string; correlationId: string; amount?: number }
    return Response.json(
      await payments.refund(session.tenantId, body.paymentIntentId, body.amount, body.correlationId),
    )
  }

  throw new ApiError(404, 'Payment route not found')
}

async function routeSuppliers(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await purchasing.listSuppliers(session.tenantId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof purchasing.createSupplier>[1]
    return Response.json(await purchasing.createSupplier(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await purchasing.getSupplier(session.tenantId, seg[1]))
  }
  if (seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as Parameters<typeof purchasing.updateSupplier>[2]
    return Response.json(await purchasing.updateSupplier(session.tenantId, seg[1], body))
  }

  throw new ApiError(404, 'Supplier route not found')
}

async function routeFulfillment(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireRole(req, OPS_ROLES)

  if (seg[1] === 'tasks' && seg.length === 2 && method === 'POST') {
    const body = (await req.json()) as wmsFulfillment.CreateFulfillmentTaskInput
    return Response.json(await wmsFulfillment.createFulfillmentTask(session.tenantId, body), { status: 201 })
  }
  if (seg[1] === 'tasks' && seg.length === 3 && method === 'DELETE') {
    const body = (await req.json()) as { correlationId?: string }
    return Response.json(
      await wmsFulfillment.cancelFulfillmentByOrder(
        session.tenantId,
        seg[2],
        body.correlationId ?? 'cancel',
      ),
    )
  }
  if (seg[1] === 'tasks' && seg.length === 4 && seg[3] === 'pack' && method === 'POST') {
    const result = await wmsFulfillment.markFulfillmentPacked(session.tenantId, seg[2])
    await orderOrchestration.onFulfillmentPacked(session.tenantId, result.orderId).catch(() => undefined)
    return Response.json(result)
  }
  if (seg[1] === 'tasks' && seg.length === 4 && seg[3] === 'dispatch' && method === 'POST') {
    const result = await wmsFulfillment.markFulfillmentDispatched(session.tenantId, seg[2])
    await orderOrchestration.onFulfillmentDispatched(session.tenantId, result.orderId).catch(() => undefined)
    return Response.json(result)
  }
  throw new ApiError(404, 'Fulfillment route not found')
}

async function routeWms(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = isRead ? await requireSession(req) : await requireRole(req, OPS_ROLES)
  const url = new URL(req.url)

  if (seg[1] === 'tasks') {
    if (seg.length === 2 && method === 'GET') {
      return Response.json(
        await wmsFulfillment.listFulfillmentTasks(
          session.tenantId,
          url.searchParams.get('status') ?? undefined,
          url.searchParams.get('warehouseId') ?? undefined,
          url.searchParams.get('orderId') ?? undefined,
        ),
      )
    }
    if (seg.length === 3 && method === 'GET') {
      return Response.json(await wmsFulfillment.getFulfillmentTask(session.tenantId, seg[2]))
    }
    if (seg.length === 4 && seg[3] === 'assign' && method === 'PATCH') {
      const body = (await req.json()) as { userId?: string | null }
      return Response.json(
        await wmsFulfillment.assignFulfillmentTask(session.tenantId, seg[2], body.userId ?? null),
      )
    }
    if (seg.length === 4 && seg[3] === 'pick-all' && method === 'POST') {
      return Response.json(await wmsFulfillment.confirmAllPickLines(session.tenantId, seg[2]))
    }
    if (seg.length === 5 && seg[3] === 'pick-lines' && method === 'PATCH') {
      const body = (await req.json()) as wmsFulfillment.ConfirmPickLineInput
      return Response.json(
        await wmsFulfillment.confirmPickLine(session.tenantId, seg[2], seg[4], body),
      )
    }
  }

  if (seg[1] === 'receiving' && seg[2] === 'sessions') {
    if (seg.length === 3 && method === 'GET') {
      return Response.json(
        await wmsReceiving.listReceivingSessions(session.tenantId, url.searchParams.get('status') ?? undefined),
      )
    }
    if (seg.length === 3 && method === 'POST') {
      const body = (await req.json()) as {
        warehouseId?: string
        poId?: string
        purchaseOrderId?: string
        asnId?: string
      }
      const warehouseId =
        body.warehouseId?.trim() ||
        (await wmsReceiving.resolveDefaultWarehouseId(session.tenantId))
      const poId = body.poId?.trim() || body.purchaseOrderId?.trim() || undefined
      return Response.json(
        await wmsReceiving.startReceivingSession(
          session.tenantId,
          warehouseId,
          session.userId,
          poId,
          body.asnId,
        ),
        { status: 201 },
      )
    }
    if (seg.length === 4 && method === 'GET') {
      return Response.json(await wmsReceiving.getReceivingSession(seg[3], session.tenantId))
    }
    if (seg.length === 5 && seg[4] === 'scan' && method === 'POST') {
      const body = (await req.json()) as {
        barcode?: string
        code?: string
        receivedQty?: number
        quantity?: number
        damagedQty?: number
        batchId?: string
        expiryDate?: string
        locationId?: string
      }
      const barcode = (body.barcode ?? body.code)?.trim()
      if (!barcode) throw new ApiError(400, 'barcode or code required')
      const receivedQty = body.receivedQty ?? body.quantity ?? 1
      return Response.json(
        await wmsReceiving.scanReceivingItem(seg[3], session.tenantId, session.userId, {
          barcode,
          receivedQty,
          damagedQty: body.damagedQty,
          batchId: body.batchId,
          expiryDate: body.expiryDate,
          locationId: body.locationId,
        }),
      )
    }
    if (seg.length === 5 && seg[4] === 'import' && method === 'POST') {
      const body = (await req.json()) as { rows?: Parameters<typeof wmsReceiving.importReceivingItems>[3] }
      return Response.json(
        await wmsReceiving.importReceivingItems(seg[3], session.tenantId, session.userId, body.rows ?? []),
      )
    }
    if (seg.length === 5 && seg[4] === 'complete' && method === 'PATCH') {
      const body = (await req.json()) as { notes?: string }
      return Response.json(
        await wmsReceiving.completeReceivingSession(
          seg[3],
          session.tenantId,
          body.notes,
          session.userId,
        ),
      )
    }
  }

  if (seg[1] === 'cycle-counts') {
    if (seg.length === 2 && method === 'GET') {
      return Response.json(await wmsCycleCount.listCycleCounts(session.tenantId))
    }
    if (seg.length === 2 && method === 'POST') {
      const body = (await req.json()) as Parameters<typeof wmsCycleCount.createCycleCount>[2]
      return Response.json(await wmsCycleCount.createCycleCount(session.tenantId, session.userId, body), {
        status: 201,
      })
    }
    if (seg.length === 3 && method === 'GET') {
      return Response.json(await wmsCycleCount.getCycleCount(session.tenantId, seg[2]))
    }
    if (seg.length === 5 && seg[3] === 'lines' && seg[4] === 'import' && method === 'POST') {
      const body = (await req.json()) as { rows?: Parameters<typeof wmsCycleCount.importCycleLineCounts>[2] }
      return Response.json(await wmsCycleCount.importCycleLineCounts(session.tenantId, seg[2], body.rows ?? []))
    }
    if (seg.length === 4 && seg[3] === 'submit-for-approval' && method === 'PATCH') {
      return Response.json(await wmsCycleCount.submitCycleCountForApproval(session.tenantId, seg[2]))
    }
    if (seg.length === 4 && seg[3] === 'approve' && (method === 'POST' || method === 'PATCH')) {
      assertRole(session, ADMIN_ROLES)
      return Response.json(
        await wmsCycleCount.approveCycleCount(session.tenantId, seg[2], session.userId),
      )
    }
    if (seg.length === 5 && seg[3] === 'lines' && method === 'PATCH') {
      const body = (await req.json()) as { countedQty?: number }
      if (body.countedQty === undefined) throw new ApiError(400, 'countedQty required')
      return Response.json(
        await wmsCycleCount.updateCycleLineCountedQty(session.tenantId, seg[2], seg[4], body.countedQty),
      )
    }
  }

  throw new ApiError(404, 'WMS route not found')
}

async function routeRoutes(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = isRead ? await requireSession(req) : await requireRole(req, ADMIN_ROLES)
  const url = new URL(req.url)

  if (seg.length === 2 && seg[1] === 'shipped-orders' && method === 'GET') {
    return Response.json(await orders.listShippedOrdersForDispatch(session.tenantId))
  }
  if (seg.length === 2 && seg[1] === 'from-orders' && method === 'POST') {
    const body = (await req.json()) as { orderIds?: string[]; name?: string; scheduledFor?: string }
    if (!body.orderIds?.length) throw new ApiError(400, 'orderIds required')
    return Response.json(
      await dispatch.createRouteFromOrders(session.tenantId, {
        orderIds: body.orderIds,
        name: body.name,
        scheduledFor: body.scheduledFor,
      }),
      { status: 201 },
    )
  }
  if (seg.length === 1 && method === 'GET') {
    return Response.json(await dispatch.listRoutes(session.tenantId, url.searchParams.get('date') ?? undefined))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof dispatch.createRoute>[1]
    return Response.json(await dispatch.createRoute(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await dispatch.getRoute(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'driver' && method === 'PATCH') {
    const body = (await req.json()) as { driverId?: string }
    if (!body.driverId) throw new ApiError(400, 'driverId required')
    return Response.json(await dispatch.assignRouteDriver(session.tenantId, seg[1], body.driverId))
  }
  if (seg.length === 4 && seg[2] === 'stops' && seg[3] === 'reorder' && method === 'PATCH') {
    const body = (await req.json()) as { stopIds?: string[] }
    if (!body.stopIds?.length) throw new ApiError(400, 'stopIds required')
    return Response.json(await dispatch.reorderRouteStops(session.tenantId, seg[1], body.stopIds))
  }
  if (seg.length === 5 && seg[2] === 'stops' && seg[4] === 'delivered' && method === 'POST') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(await dispatch.markStopDelivered(session.tenantId, seg[1], seg[3], body))
  }
  if (seg.length === 5 && seg[2] === 'stops' && seg[4] === 'failed' && method === 'POST') {
    const body = (await req.json()) as { reason?: string }
    return Response.json(await dispatch.markStopFailed(session.tenantId, seg[1], seg[3], body.reason))
  }
  throw new ApiError(404, 'Route route not found')
}

async function routeDispatchMobile(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireRole(req, DRIVER_ROLES)

  if (seg[1] === 'driver' && seg[2] === 'location' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof dispatch.recordDriverLocation>[2]
    return Response.json(await dispatch.recordDriverLocation(session.tenantId, session.userId, body))
  }
  if (seg[1] === 'stops' && seg.length === 4 && seg[3] === 'pod' && method === 'POST') {
    const body = (await req.json()) as Record<string, unknown>
    const routeId = String(body.routeId ?? '')
    if (!routeId.trim()) throw new ApiError(400, 'routeId is required in body')
    const { routeId: _r, stopId: _s, ...pod } = body
    return Response.json(await dispatch.markStopDelivered(session.tenantId, routeId, seg[2], pod))
  }
  throw new ApiError(404, 'Dispatch route not found')
}

async function routeMsa(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const url = new URL(req.url)

  if (seg.length === 2 && seg[1] === 'reports' && method === 'GET') {
    return Response.json(
      await complianceMsa.listReports(session.tenantId, url.searchParams.get('status') ?? undefined),
    )
  }
  if (seg.length === 3 && seg[1] === 'reports' && method === 'GET') {
    return Response.json(await complianceMsa.getReport(session.tenantId, seg[2]))
  }
  if (seg.length === 3 && seg[1] === 'reports' && seg[2] === 'generate' && method === 'POST') {
    const offset = url.searchParams.get('weekOffset')
    const weekOffset = offset ? parseInt(offset, 10) : 0
    const ids = await complianceMsa.generateReportForTenant(session.tenantId, weekOffset)
    return Response.json({ reports: ids })
  }
  if (seg.length === 2 && seg[1] === 'run-now' && method === 'POST') {
    const offset = url.searchParams.get('weekOffset')
    const weekOffset = offset ? parseInt(offset, 10) : 0
    const ids = await complianceMsa.generateReportForTenant(session.tenantId, weekOffset)
    return Response.json({ reports: ids })
  }
  if (seg.length === 3 && seg[1] === 'transactions' && seg[2] === 'import' && method === 'POST') {
    const body = (await req.json()) as { rows?: complianceMsa.MsaTransactionImportRow[] }
    return Response.json(await complianceMsa.importTransactions(session.tenantId, body.rows ?? []))
  }
  if (seg.length === 2 && seg[1] === 'config' && method === 'GET') {
    return Response.json(await complianceMsa.getConfig(session.tenantId))
  }
  if (seg.length === 2 && seg[1] === 'config' && method === 'POST') {
    const body = (await req.json()) as complianceMsa.UpsertMsaConfigInput
    return Response.json(await complianceMsa.upsertConfig(session.tenantId, body))
  }
  throw new ApiError(404, 'MSA route not found')
}

async function routeTax(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg.length === 2 && seg[1] === 'settings' && method === 'GET') {
    return Response.json(await getTenantTaxSettings(session.tenantId))
  }
  if (seg.length === 2 && seg[1] === 'summary' && method === 'GET') {
    return Response.json(await complianceTax.taxSummary(session.tenantId))
  }
  if (seg.length === 2 && seg[1] === 'record' && method === 'POST') {
    const body = (await req.json()) as complianceTax.RecordTaxInput
    return Response.json(await complianceTax.recordTax(session.tenantId, body))
  }
  throw new ApiError(404, 'Tax route not found')
}

async function routeNotifications(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await notifications.list(session.tenantId))
  }
  if (seg.length === 2 && seg[1] === 'send' && method === 'POST') {
    const key = req.headers.get('idempotency-key')?.trim() || undefined
    const body = (await req.json()) as notifications.SendNotificationInput
    return Response.json(await notifications.send(session.tenantId, body, key))
  }
  throw new ApiError(404, 'Notification route not found')
}

async function routeJournalEntries(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await ledger.listJournalEntries(session.tenantId))
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await ledger.getJournalEntry(session.tenantId, seg[1]))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as ledger.CreateJournalEntryInput
    return Response.json(await ledger.createJournalDraft(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 3 && seg[2] === 'post' && method === 'POST') {
    return Response.json(await ledger.postJournalEntry(session.tenantId, seg[1]))
  }
  throw new ApiError(404, 'Journal entry route not found')
}

async function routeChartAccounts(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await ledger.listChartAccounts(session.tenantId))
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await ledger.getChartAccount(session.tenantId, seg[1]))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as ledger.CreateChartAccountInput
    return Response.json(await ledger.createChartAccount(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as { name?: string; isActive?: boolean }
    return Response.json(await ledger.patchChartAccount(session.tenantId, seg[1], body))
  }
  throw new ApiError(404, 'Chart account route not found')
}

async function routeReports(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const url = new URL(req.url)

  if (seg.length === 2 && seg[1] === 'trial-balance' && method === 'GET') {
    const y = url.searchParams.get('year')
    const m = url.searchParams.get('month')
    const year = y ? parseInt(y, 10) : new Date().getFullYear()
    const month = m ? parseInt(m, 10) : new Date().getMonth() + 1
    return Response.json(await ledger.trialBalance(session.tenantId, year, month))
  }
  throw new ApiError(404, 'Report route not found')
}

async function routeKpi(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg.length === 2 && seg[1] === 'snapshots' && method === 'GET') {
    return Response.json(await analytics.listSnapshots(session.tenantId))
  }
  throw new ApiError(404, 'KPI route not found')
}

async function routeAnalytics(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg.length === 2 && seg[1] === 'kpis' && method === 'GET') {
    return Response.json(await analytics.dashboardKpis(session.tenantId))
  }
  throw new ApiError(404, 'Analytics route not found')
}

async function routeInternal(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg.length === 2 && seg[1] === 'refresh' && method === 'POST') {
    const body = (await req.json()) as analytics.RefreshKpiInput
    return Response.json(await analytics.upsertSnapshot(session.tenantId, session.role, body))
  }
  throw new ApiError(404, 'Internal route not found')
}

async function routeWebhooks(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await webhooks.listWebhooks(session.tenantId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as webhooks.CreateWebhookInput
    return Response.json(await webhooks.createWebhook(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'DELETE') {
    await webhooks.deleteWebhook(session.tenantId, seg[1])
    return new Response(null, { status: 204 })
  }
  if (seg.length === 3 && seg[2] === 'test' && method === 'POST') {
    return Response.json(await webhooks.testWebhook(session.tenantId, seg[1]))
  }
  throw new ApiError(404, 'Webhook route not found')
}
