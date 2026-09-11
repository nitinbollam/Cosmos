import { checkDatabaseConnections } from './db-health'
import { requireRole, ADMIN_ROLES, toJsonError } from './session'
import { routeTenants, routeUsers } from './routes/auth-users'
import { routeSkus, routeWarehouses, routeInventory, routeBins, routeVolumePrices } from './routes/catalog-inventory'
import { routeOrders, routeQuotes, routeOrderTemplates } from './routes/sales-orders'
import { routeCustomers, routeLeads, routeActivities } from './routes/crm'
import { routeFulfillment, routeWms, routePickWaves } from './routes/wms'
import { routeRoutes, routeDispatchMobile, routePurchaseOrders, routeSuppliers, routeEdi } from './routes/logistics'
import {
  routeInvoices,
  routeBills,
  routePayments,
  routeSavedPaymentMethods,
  routeJournalEntries,
  routeChartAccounts,
  routeBankAccounts,
  routeFixedAssets,
  routeTax,
} from './routes/finance'
import { routeMsa, routeCompliance } from './routes/compliance'
import { routeMarketplace } from './routes/marketplace'
import { routePlerosOps } from './routes/pleros-ops'
import {
  routeNotifications,
  routeReports,
  routeReportBuilder,
  routeKpi,
  routeAnalytics,
  routeInternal,
  routeWebhooks,
  routeAudit,
  routeSearch,
  routePos,
  routeFeatures,
  routeCelestial,
} from './routes/system'

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
    if (seg[0] === 'edi') return await routeEdi(m, seg, req)
    if (seg[0] === 'health' && seg[1] === 'db' && m === 'GET') {
      await requireRole(req, ADMIN_ROLES)
      return Response.json(await checkDatabaseConnections())
    }
    if (seg[0] === 'bills') return await routeBills(m, seg, req)
    if (seg[0] === 'suppliers') return await routeSuppliers(m, seg, req)
    if (seg[0] === 'payments') return await routePayments(m, seg, req)
    if (seg[0] === 'msa') return await routeMsa(m, seg, req)
    if (seg[0] === 'tax') return await routeTax(m, seg, req)
    if (seg[0] === 'compliance') return await routeCompliance(m, seg, req)
    if (seg[0] === 'notifications') return await routeNotifications(m, seg, req)
    if (seg[0] === 'journal-entries') return await routeJournalEntries(m, seg, req)
    if (seg[0] === 'chart-accounts') return await routeChartAccounts(m, seg, req)
    if (seg[0] === 'reports') return await routeReports(m, seg, req)
    if (seg[0] === 'report-builder') return await routeReportBuilder(m, seg, req)
    if (seg[0] === 'kpi') return await routeKpi(m, seg, req)
    if (seg[0] === 'analytics') return await routeAnalytics(m, seg, req)
    if (seg[0] === 'internal') return await routeInternal(m, seg, req)
    if (seg[0] === 'webhooks') return await routeWebhooks(m, seg, req)
    if (seg[0] === 'bank-accounts') return await routeBankAccounts(m, seg, req)
    if (seg[0] === 'fixed-assets') return await routeFixedAssets(m, seg, req)
    if (seg[0] === 'audit') return await routeAudit(m, seg, req)
    if (seg[0] === 'search') return await routeSearch(m, seg, req)
    if (seg[0] === 'order-templates') return await routeOrderTemplates(m, seg, req)
    if (seg[0] === 'pick-waves') return await routePickWaves(m, seg, req)
    if (seg[0] === 'bins') return await routeBins(m, seg, req)
    if (seg[0] === 'saved-payment-methods') return await routeSavedPaymentMethods(m, seg, req)
    if (seg[0] === 'pos') return await routePos(m, seg, req)
    if (seg[0] === 'features') return await routeFeatures(m, seg, req)
    if (seg[0] === 'volume-prices') return await routeVolumePrices(m, seg, req)
    if (seg[0] === 'celestial') return await routeCelestial(m, seg, req)
    if (seg[0] === 'marketplace') return await routeMarketplace(m, seg, req)
    if (seg[0] === 'pleros-ops') return await routePlerosOps(m, seg, req)
    return null
  } catch (e) {
    return toJsonError(e)
  }
}
