import * as inv from '../inventory'
import * as invoices from '../invoices'
import * as orders from '../orders'
import * as quotes from '../quotes'
import * as search from '../search'
import { isPortalBuyer } from '../buyer-context'
import type { SessionUser } from '../session'
import type { CelestialToolName } from './intent'

export type ToolContext = {
  session: SessionUser
  customerId?: string | null
  customerName?: string | null
  orderId?: string
  quoteId?: string
  searchTerm?: string
  orderStatus?: string
}

export type ToolResult = {
  name: CelestialToolName
  data: unknown
  links: Array<{ label: string; href: string }>
}

export async function runTools(names: CelestialToolName[], ctx: ToolContext): Promise<ToolResult[]> {
  const results: ToolResult[] = []
  for (const name of names) {
    const result = await runTool(name, ctx)
    if (result) results.push(result)
  }
  return results
}

async function runTool(name: CelestialToolName, ctx: ToolContext): Promise<ToolResult | null> {
  const { session } = ctx
  const isBuyer = isPortalBuyer(session.role)
  const buyerOpts = isBuyer && ctx.customerId ? { buyerCustomerId: ctx.customerId } : undefined

  switch (name) {
    case 'get_my_orders': {
      const filters: { status?: string } = {}
      if (ctx.orderStatus) filters.status = ctx.orderStatus
      const page = await orders.listOrders(session.tenantId, 1, 10, filters, buyerOpts)
      const links = page.items.map((o) => ({
        label: `Order …${o.id.slice(-8)} (${o.status})`,
        href: isBuyer ? `/orders/${o.id}` : `/admin/orders/${o.id}`,
      }))
      return {
        name,
        data: page.items.map((o) => ({
          id: o.id,
          status: o.status,
          total: Number(o.totalAmount),
          createdAt: o.createdAt,
          lineCount: o.lineItems.length,
        })),
        links,
      }
    }
    case 'get_order_detail': {
      if (!ctx.orderId) return null
      const order = await orders.findOrderById(session.tenantId, ctx.orderId, buyerOpts)
      return {
        name,
        data: {
          id: order.id,
          status: order.status,
          total: Number(order.totalAmount),
          amountPaid: Number(order.amountPaid),
          paymentMethod: order.paymentMethod,
          lines: order.lineItems.map((l) => ({
            skuId: l.skuId,
            qty: l.quantity,
            unitPrice: Number(l.unitPrice),
          })),
        },
        links: [
          {
            label: `Order …${order.id.slice(-8)}`,
            href: isBuyer ? `/orders/${order.id}` : `/admin/orders/${order.id}`,
          },
        ],
      }
    }
    case 'list_my_invoices': {
      const page = await invoices.listInvoices(session.tenantId, 1, 8, {}, buyerOpts)
      return {
        name,
        data: page.items.map((invRow) => ({
          id: invRow.id,
          invoiceNumber: invRow.invoiceNumber,
          status: invRow.displayStatus ?? invRow.status,
          total: Number(invRow.totalAmount),
          balance: invRow.balance,
          orderId: invRow.orderId,
        })),
        links: page.items.map((invRow) => ({
          label: invRow.invoiceNumber,
          href: isBuyer ? `/invoices/${invRow.id}` : `/admin/finance`,
        })),
      }
    }
    case 'search_catalog': {
      const term = ctx.searchTerm?.trim() || 'energy'
      const page = await inv.listSkus(session.tenantId, 1, 8, term, {
        inStockOnly: true,
        customerId: ctx.customerId ?? undefined,
      })
      return {
        name,
        data: page.items.map((s) => ({
          code: s.code,
          name: s.name,
          price: Number(s.price),
          available: s.quantityAvailable,
          id: s.id,
        })),
        links: [{ label: 'Browse catalog', href: '/catalog' }],
      }
    }
    case 'list_my_quotes': {
      const rows = await quotes.listQuotes(session.tenantId, undefined, buyerOpts)
      const slice = rows.slice(0, 8)
      return {
        name,
        data: slice.map((q) => ({
          id: q.id,
          status: q.status,
          lineCount: q.lines.length,
          createdAt: q.createdAt,
        })),
        links: slice.map((q) => ({
          label: `Quote …${q.id.slice(-8)}`,
          href: isBuyer ? `/quotes/${q.id}` : `/admin/quotes`,
        })),
      }
    }
    case 'global_search': {
      const term = ctx.searchTerm?.trim() || 'acme'
      const data = await search.globalSearch(session.tenantId, term, 6)
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
      const page = await inv.listSkus(session.tenantId, 1, 10, undefined, { inStockOnly: false })
      const low = page.items.filter((s) => (s.quantityAvailable ?? 0) <= (s.reorderPoint ?? 0))
      return {
        name,
        data: low.map((s) => ({
          code: s.code,
          name: s.name,
          available: s.quantityAvailable,
          reorderPoint: s.reorderPoint,
        })),
        links: low.map((s) => ({ label: s.code, href: `/admin/inventory/${s.id}` })),
      }
    }
    case 'list_warehouses': {
      const rows = await inv.listWarehouses(session.tenantId)
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
        links: [
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
    .map((r) => `Tool: ${r.name}\n${JSON.stringify(r.data, null, 2)}`)
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
