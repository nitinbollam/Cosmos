import * as inv from '../inventory'
import * as invoices from '../invoices'
import * as search from '../search'
import { isPortalBuyer } from '../buyer-context'
import { hasPermission } from '../permissions'
import { ApiError, type SessionUser } from '../session'
import type { CelestialToolName, ToolParams } from './intent'
import { orderCodeOf } from '../order-number'
import * as erp from './erp-queries'

export type ToolContext = ToolParams & {
  session: SessionUser
  customerId?: string | null
  customerName?: string | null
}

export type ToolResult = {
  name: CelestialToolName
  data: unknown
  links: Array<{ label: string; href: string }>
  error?: string
  /** Shown to the user instead of data: a clarifying question or an access explanation. */
  notice?: string
}

/**
 * Module permission each tool reads under. Any one listed permission is enough. Checked on every
 * request against the live session, so revoking a grant takes effect immediately.
 */
export const TOOL_PERMISSIONS: Record<CelestialToolName, string[]> = {
  'orders.list': ['orders.read'],
  'orders.detail': ['orders.read'],
  'inventory.stock': ['inventory.read'],
  'purchasing.orders': ['purchasing.read'],
  'purchasing.order_detail': ['purchasing.read'],
  'finance.bills': ['finance.read'],
  'quotes.list': ['quotes.read'],
  'quotes.detail': ['quotes.read'],
  'sales.summary': ['reports.read', 'finance.read'],
  'sales.forecast': ['reports.read', 'finance.read'],
  'sales.by_product': ['reports.read', 'finance.read'],
  'sales.by_customer': ['reports.read', 'finance.read'],
  'purchasing.suppliers': ['purchasing.read'],
  'inventory.by_warehouse': ['inventory.read', 'wms.read'],
  list_my_invoices: ['finance.read'],
  search_catalog: ['inventory.read'],
  global_search: ['crm.read'],
  list_low_stock: ['inventory.read'],
  list_warehouses: ['inventory.read', 'wms.read'],
}

const TOOL_LABELS: Record<CelestialToolName, string> = {
  'orders.list': 'orders',
  'orders.detail': 'order details',
  'inventory.stock': 'stock levels',
  'purchasing.orders': 'purchase orders',
  'purchasing.order_detail': 'purchase order details',
  'finance.bills': 'vendor bills',
  'quotes.list': 'quotes',
  'quotes.detail': 'quote details',
  'sales.summary': 'sales totals',
  'sales.forecast': 'sales forecasts',
  'sales.by_product': 'sales by product',
  'sales.by_customer': 'sales by customer',
  'purchasing.suppliers': 'suppliers',
  'inventory.by_warehouse': 'stock per warehouse',
  list_my_invoices: 'invoices',
  search_catalog: 'products',
  global_search: 'customer search',
  list_low_stock: 'low-stock alerts',
  list_warehouses: 'warehouses',
}

export function canUseTool(session: SessionUser, name: CelestialToolName): boolean {
  // Celestial is employee-only: the ERP tools read tenant-wide data and carry no buyer scoping.
  if (isPortalBuyer(session.role)) return false
  return TOOL_PERMISSIONS[name].some((p) => hasPermission(session, p))
}

export async function runTools(names: CelestialToolName[], ctx: ToolContext): Promise<ToolResult[]> {
  const results: ToolResult[] = []
  for (const name of names) {
    if (!canUseTool(ctx.session, name)) {
      results.push({
        name,
        data: null,
        links: [],
        notice: `You don't have access to ${TOOL_LABELS[name]} in Pleros (needs ${TOOL_PERMISSIONS[name].join(' or ')}). Ask an admin if you need it.`,
      })
      continue
    }
    try {
      const result = await runTool(name, ctx)
      if (result) results.push(result)
    } catch (e) {
      // Raw database errors carry file paths and schema details: log them here, and give the user
      // (and any model) only a plain statement that this part of the answer is missing.
      console.error(`[celestial] tool ${name} failed (tenant=${ctx.session.tenantId}):`, e)
      const message = e instanceof ApiError ? e.message : 'lookup failed'
      results.push({
        name,
        data: null,
        links: [],
        error: message,
        notice: `I couldn’t read ${TOOL_LABELS[name]} just now (${message}), so they are missing from this answer.`,
      })
    }
  }
  return results
}

/** Human-readable list of the filters applied, so answers say what subset they describe. */
function filterLabels(ctx: ToolContext, ...extra: Array<string | false | null | undefined>): string[] {
  const labels = extra.filter((x): x is string => Boolean(x))
  if (ctx.dateRange) labels.push(ctx.dateRange.label)
  if (ctx.byAmount) labels.push(ctx.sort === 'asc' ? 'smallest first' : 'largest first')
  else if (ctx.sort === 'asc') labels.push('oldest first')
  return labels
}

/** Mark a single record picked from a list ("Biggest order of 5 matching orders"). */
function withSelection(result: ToolResult | null, selection: string): ToolResult | null {
  if (result?.data && typeof result.data === 'object') (result.data as Record<string, unknown>).selection = selection
  return result
}

/** Customer ids for a named customer, or a notice when nobody matches. */
async function customerFilter(tenantId: string, name?: string): Promise<{ ids?: string[]; notice?: string }> {
  if (!name) return {}
  const ids = await erp.resolveCustomerIds(tenantId, name)
  return ids.length > 0 ? { ids } : { notice: `I couldn’t find a customer named “${name}”. Check the spelling or try part of the name.` }
}

async function runTool(name: CelestialToolName, ctx: ToolContext): Promise<ToolResult | null> {
  const { session } = ctx
  const tenantId = session.tenantId
  const isBuyer = isPortalBuyer(session.role)
  const buyerOpts = isBuyer && ctx.customerId ? { buyerCustomerId: ctx.customerId } : undefined

  switch (name) {
    case 'orders.list': {
      const cust = await customerFilter(tenantId, ctx.customer)
      if (cust.notice) return { name, data: null, links: [], notice: cust.notice }
      const page = await erp.ordersList(tenantId, {
        status: ctx.orderStatus,
        statuses: ctx.orderStatuses,
        customerIds: cust.ids,
        byAmount: ctx.byAmount,
        channel: ctx.channel,
        priority: ctx.priority,
        dateRange: ctx.dateRange,
        sort: ctx.sort,
        page: ctx.page,
      })
      // "The latest order" is one record: answer with its details rather than a list.
      if (ctx.limit === 1 && page.rows[0]) {
        const pick = ctx.byAmount ? (ctx.sort === 'asc' ? 'Smallest order' : 'Biggest order') : ctx.sort === 'asc' ? 'Oldest order' : 'Latest order'
        return withSelection(
          await runTool('orders.detail', { ...ctx, orderId: page.rows[0].id, orderNumber: undefined }),
          `${pick} of ${page.total} matching order(s)${ctx.byAmount ? ', by order total' : ''}.`,
        )
      }
      return {
        name,
        data: {
          ...page,
          filters: filterLabels(
            ctx,
            ctx.orderStatus,
            ctx.orderStatuses && 'not yet shipped',
            ctx.channel,
            ctx.priority,
            ctx.customer && `customer “${ctx.customer}”`,
          ),
        },
        links: page.rows.map((o) => ({
          label: `Order ${orderCodeOf(o)} (${o.status})`,
          href: `/admin/orders/${o.id}`,
        })),
      }
    }
    case 'orders.detail': {
      const order = await erp.ordersDetail(tenantId, { id: ctx.orderId, orderNumber: ctx.orderNumber })
      if (!order) {
        return { name, data: null, links: [], notice: 'I couldn’t find that order. Check the order number (e.g. ORD-1001).' }
      }
      return {
        name,
        data: order,
        links: [{ label: `Order ${orderCodeOf(order)}`, href: `/admin/orders/${order.id}` }],
      }
    }
    case 'inventory.stock': {
      let warehouses: Array<{ id: string; name: string }> | undefined
      if (ctx.warehouse) {
        warehouses = await erp.resolveWarehouses(tenantId, ctx.warehouse)
        if (warehouses.length === 0) {
          return { name, data: null, links: [], notice: `I couldn’t find a warehouse named “${ctx.warehouse}”. Ask “what warehouses do we have?” to see them.` }
        }
      }
      const stock = await erp.inventoryStock(tenantId, {
        tokens: ctx.searchTokens ?? [],
        rank: ctx.stockRank,
        warehouseIds: warehouses?.map((w) => w.id),
      })
      const limit = stock.rank ? ctx.limit : undefined
      const skuSummaries = limit ? stock.skuSummaries.slice(0, limit) : stock.skuSummaries
      return {
        name,
        data: {
          ...stock,
          skuSummaries,
          limit,
          search: (ctx.searchTokens ?? []).join(' '),
          warehouse: warehouses?.map((w) => w.name).join(', '),
        },
        links: skuSummaries.slice(0, 6).map((s) => ({
          label: s.code,
          href: s.skuId ? `/admin/inventory/${s.skuId}` : '/admin/inventory',
        })),
      }
    }
    case 'purchasing.orders': {
      const page = await erp.purchasingOrders(tenantId, {
        status: ctx.poStatus,
        statuses: ctx.poStatuses,
        supplier: ctx.supplier,
        dateRange: ctx.dateRange,
        page: ctx.page,
      })
      if (ctx.limit === 1 && page.rows[0]) {
        return withSelection(
          await runTool('purchasing.order_detail', { ...ctx, poRef: page.rows[0].number }),
          `${ctx.sort === 'asc' ? 'Oldest' : 'Latest'} of ${page.total} matching purchase order(s).`,
        )
      }
      return {
        name,
        data: {
          ...page,
          filters: filterLabels(
            ctx,
            ctx.poStatus,
            ctx.poStatuses && 'still to be received',
            ctx.supplier && `supplier “${ctx.supplier}”`,
          ),
        },
        links: page.rows.map((po) => ({ label: po.number, href: `/admin/purchasing/${po.id}` })),
      }
    }
    case 'purchasing.order_detail': {
      const po = await erp.purchasingOrderDetail(tenantId, { number: ctx.poRef })
      if (!po) {
        return { name, data: null, links: [], notice: `I couldn’t find purchase order ${ctx.poRef ?? ''}. Check the PO number.` }
      }
      return { name, data: po, links: [{ label: po.number, href: `/admin/purchasing/${po.id}` }] }
    }
    case 'finance.bills': {
      const page = await erp.financeBills(tenantId, {
        status: ctx.billStatus,
        outstanding: ctx.outstanding,
        pastDue: ctx.pastDue,
        supplier: ctx.supplier,
        dateRange: ctx.dateRange,
        page: ctx.page,
      })
      const filters = filterLabels(
        ctx,
        ctx.billStatus,
        ctx.pastDue ? 'past due' : ctx.outstanding === true ? 'outstanding' : ctx.outstanding === false ? 'paid' : undefined,
        ctx.supplier && `supplier “${ctx.supplier}”`,
      )
      return {
        name,
        data: { ...page, filters },
        links: page.rows.length > 0 ? [{ label: 'Bills (AP)', href: '/admin/finance' }] : [],
      }
    }
    case 'quotes.list': {
      const cust = await customerFilter(tenantId, ctx.customer)
      if (cust.notice) return { name, data: null, links: [], notice: cust.notice }
      const page = await erp.quotesList(tenantId, {
        status: ctx.quoteStatus,
        dateRange: ctx.dateRange,
        page: ctx.page,
        customerIds: cust.ids,
      })
      if (ctx.limit === 1 && page.rows[0]) {
        return withSelection(
          await runTool('quotes.detail', { ...ctx, quoteId: page.rows[0].id, quoteRef: undefined }),
          `${ctx.sort === 'asc' ? 'Oldest' : 'Latest'} of ${page.total} matching quote(s).`,
        )
      }
      return {
        name,
        data: { ...page, filters: filterLabels(ctx, ctx.quoteStatus, ctx.customer && `customer “${ctx.customer}”`) },
        links: page.rows.length > 0 ? [{ label: 'Quotes', href: '/admin/quotes' }] : [],
      }
    }
    case 'quotes.detail': {
      const quote = await erp.quotesDetail(tenantId, { id: ctx.quoteId, idSuffix: ctx.quoteRef })
      if (!quote) return { name, data: null, links: [], notice: 'I couldn’t find that quote. Check the quote number (e.g. Q-AB12CD34).' }
      const links = [{ label: quote.quoteNumber, href: '/admin/quotes' }]
      if (quote.convertedOrderId) links.push({ label: 'Converted order', href: `/admin/orders/${quote.convertedOrderId}` })
      return { name, data: quote, links }
    }
    case 'sales.summary': {
      const summary = await erp.salesSummary(tenantId, { dateRange: ctx.dateRange })
      return {
        name,
        data: summary,
        links: [{ label: 'Reports', href: '/admin/reports' }],
      }
    }
    case 'sales.forecast': {
      const forecast = await erp.salesForecast(tenantId)
      return {
        name,
        data: forecast,
        links: [{ label: 'Reports', href: '/admin/reports' }],
      }
    }
    case 'sales.by_product': {
      const ranking = await erp.salesByProduct(tenantId, {
        dateRange: ctx.dateRange,
        rank: ctx.salesRank,
        tokens: ctx.searchTokens,
      })
      const rows = ctx.limit ? ranking.rows.slice(0, ctx.limit) : ranking.rows
      return {
        name,
        data: { ...ranking, rows, limit: ctx.limit, search: (ctx.searchTokens ?? []).join(' ') },
        links: rows.slice(0, 6).map((r) => ({ label: r.code, href: `/admin/inventory/${r.skuId}` })),
      }
    }
    case 'sales.by_customer': {
      const ranking = await erp.salesByCustomer(tenantId, { dateRange: ctx.dateRange, rank: ctx.salesRank })
      const rows = ctx.limit ? ranking.rows.slice(0, ctx.limit) : ranking.rows
      return {
        name,
        data: { ...ranking, rows, limit: ctx.limit },
        links: rows.slice(0, 6).map((r) => ({ label: r.name, href: `/admin/crm/customers/${r.customerId}` })),
      }
    }
    case 'purchasing.suppliers': {
      const list = await erp.suppliersList(tenantId)
      return { name, data: list, links: list.rows.length ? [{ label: 'Purchasing', href: '/admin/purchasing' }] : [] }
    }
    case 'inventory.by_warehouse': {
      const totals = await erp.stockByWarehouse(tenantId, ctx.stockRank ?? 'desc')
      const rows = ctx.limit ? totals.rows.slice(0, ctx.limit) : totals.rows
      return {
        name,
        data: { ...totals, rows, rank: ctx.stockRank ?? 'desc', limit: ctx.limit, warehouses: totals.rows.length },
        links: [{ label: 'Warehouse', href: '/admin/warehouse' }],
      }
    }
    case 'list_my_invoices': {
      const cust = isBuyer ? {} : await customerFilter(tenantId, ctx.customer)
      if (cust.notice) return { name, data: null, links: [], notice: cust.notice }
      const page = await invoices.listInvoices(tenantId, 1, 50, cust.ids?.length === 1 ? { customerId: cust.ids[0] } : {}, buyerOpts)
      // "Unpaid" = still has a balance and isn't void or credited.
      const matching = ctx.outstanding
        ? page.items.filter((i) => Number(i.balance) > 0 && !['VOID', 'CREDITED'].includes(String(i.status)))
        : page.items
      const shown = matching.slice(0, 8)
      return {
        name,
        data: {
          rows: shown.map((invRow) => ({
            id: invRow.id,
            invoiceNumber: invRow.invoiceNumber,
            status: invRow.displayStatus ?? invRow.status,
            total: Number(invRow.totalAmount),
            balance: invRow.balance,
            orderId: invRow.orderId,
          })),
          total: matching.length,
          filters: filterLabels(ctx, ctx.outstanding && 'unpaid', ctx.customer && `customer “${ctx.customer}”`),
          outstandingOnly: Boolean(ctx.outstanding),
        },
        links: shown.map((invRow) => ({
          label: invRow.invoiceNumber,
          href: isBuyer ? `/invoices/${invRow.id}` : `/admin/finance`,
        })),
      }
    }
    case 'search_catalog': {
      const tokens = ctx.searchTokens ?? []
      if (tokens.length === 0 && !ctx.priceRank) {
        return {
          name,
          data: null,
          links: [],
          notice: 'Which product are you looking for? Give me a name, SKU code or keyword (e.g. “cable”).',
        }
      }
      const page = await erp.catalogSearch(tenantId, tokens, ctx.page, ctx.priceRank)
      const rows = ctx.limit ? page.rows.slice(0, ctx.limit) : page.rows
      return {
        name,
        data: { ...page, rows, search: tokens.join(' '), priceRank: ctx.priceRank, limit: ctx.limit },
        links: page.rows.map((s) => ({ label: s.code, href: isBuyer ? '/catalog' : `/admin/inventory/${s.id}` })),
      }
    }
    case 'global_search': {
      const term = ctx.searchTerm?.trim()
      if (!term) return null
      const data = await search.globalSearch(tenantId, term, 6)
      return {
        name,
        data,
        links: [
          ...data.orders.map((o) => ({ label: `Order …${o.id.slice(-8)}`, href: `/admin/orders/${o.id}` })),
          ...data.customers.map((c) => ({ label: c.name, href: `/admin/crm/customers/${c.id}` })),
          ...data.skus.map((s) => ({ label: s.code, href: `/admin/inventory/${s.id}` })),
        ],
      }
    }
    case 'list_low_stock': {
      const { lowStock } = await inv.lowStockAlerts(tenantId)
      return {
        name,
        data: lowStock.map((s) => ({
          code: s.code,
          name: s.name,
          available: s.available,
          reorderPoint: s.reorderPoint,
          id: s.skuId,
        })),
        links: isBuyer
          ? [{ label: 'Browse catalog', href: '/catalog' }]
          : lowStock.map((s) => ({ label: s.code, href: `/admin/inventory/${s.skuId}` })),
      }
    }
    case 'list_warehouses': {
      const rows = await inv.listWarehouses(tenantId)
      const active = rows.filter((w) => w.isActive)
      return {
        name,
        data: active.map((w) => ({
          id: w.id,
          name: w.name,
          code: w.code,
          isDefault: w.isDefault,
          address: formatWarehouseAddress(w.address),
          city: formatWarehouseCity(w.address),
        })),
        links: isBuyer
          ? []
          : [
              { label: 'Warehouse ops', href: '/admin/warehouse' },
              { label: 'Manage warehouses', href: '/admin/settings?tab=warehouses' },
            ],
      }
    }
    default:
      return null
  }
}

export function formatToolResultsForPrompt(results: ToolResult[]): string {
  if (results.length === 0) return '(No live data was fetched for this question.)'
  return results
    .map((r) => {
      if (r.notice) return `Tool: ${r.name} (notice: ${r.notice})`
      if (r.error) return `Tool: ${r.name} (error: ${r.error})`
      return `Tool: ${r.name}\n${JSON.stringify(r.data, null, 2)}`
    })
    .join('\n\n')
}

function formatWarehouseCity(address: unknown): string | null {
  if (!address || typeof address !== 'object' || Array.isArray(address)) return null
  const city = (address as Record<string, unknown>).city
  const state = (address as Record<string, unknown>).state
  if (typeof city === 'string' && typeof state === 'string') return `${city}, ${state}`
  if (typeof city === 'string') return city
  return null
}

function formatWarehouseAddress(address: unknown): string | null {
  if (!address || typeof address !== 'object' || Array.isArray(address)) return null
  const o = address as Record<string, unknown>
  const line1 = typeof o.line1 === 'string' ? o.line1 : ''
  const city = typeof o.city === 'string' ? o.city : ''
  const state = typeof o.state === 'string' ? o.state : ''
  const parts = [line1, [city, state].filter(Boolean).join(', ')].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}
