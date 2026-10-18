/**
 * Models that deliberately have no `tenantId` column, with the reason. A new model without `tenantId`
 * must be added here (and justified in review) or the model-coverage test fails.
 *
 * Keys are `<schema>.<Model>`.
 */
export type ExemptReason =
  | 'child' // reached only through a tenant-scoped parent row
  | 'root' // the tenant itself; keyed by id
  | 'cross-tenant' // belongs to two tenants by design (marketplace); scoped by its own participant columns
  | 'global' // shared reference or infrastructure data

export const TENANT_EXEMPT_MODELS: Record<string, { reason: ExemptReason; note: string }> = {
  'analytics.CelestialMessage': { reason: 'child', note: 'belongs to a CelestialConversation (tenant-scoped)' },
  'auth.RateLimitBucket': { reason: 'global', note: 'auth rate-limit counters keyed by IP/email, before a tenant is known (PLR-160)' },
  'auth.Tenant': { reason: 'root', note: 'the tenant row; id is the tenant id' },
  'compliance.MSAManufacturerDid': { reason: 'cross-tenant', note: 'keyed by msaTenantId (an MSA party), read across tenants by design' },
  'dispatch.RouteStop': { reason: 'child', note: 'belongs to a DeliveryRoute' },
  'ledger.JournalLine': { reason: 'child', note: 'belongs to a JournalEntry' },
  'ledger.ExpenseLine': { reason: 'child', note: 'belongs to an Expense' },
  'ledger.ExchangeRate': { reason: 'global', note: 'shared FX reference data' },
  'ledger.BudgetLine': { reason: 'child', note: 'belongs to a Budget' },
  'marketplace.MarketplaceListing': { reason: 'cross-tenant', note: 'sellerTenantId; visible to all buyers' },
  'marketplace.MarketplaceBid': { reason: 'cross-tenant', note: 'bidderTenantId; seen by the seller' },
  'marketplace.MarketplaceOrder': { reason: 'cross-tenant', note: 'buyerTenantId and sellerTenantId' },
  'marketplace.MarketplaceRating': { reason: 'cross-tenant', note: 'raterTenantId and ratedTenantId' },
  'marketplace.MarketplaceDispute': { reason: 'cross-tenant', note: 'openedByTenantId and the counterparty' },
  'marketplace.MarketplaceMessage': { reason: 'cross-tenant', note: 'senderTenantId' },
  'marketplace.MarketplaceShipmentRequest': { reason: 'cross-tenant', note: 'derived from a MarketplaceOrder' },
  'order.OrderLineItem': { reason: 'child', note: 'belongs to an Order' },
  'payment.StripeWebhookEvent': { reason: 'global', note: 'platform-level webhook dedupe, before a tenant is known' },
  'purchasing.PurchaseOrderLine': { reason: 'child', note: 'belongs to a PurchaseOrder' },
  'purchasing.VendorBillLine': { reason: 'child', note: 'belongs to a VendorBill' },
  'storefront.QuoteLine': { reason: 'child', note: 'belongs to a Quote' },
  'storefront.OrderTemplateLine': { reason: 'child', note: 'belongs to an OrderTemplate' },
  'storefront.QuoteCounterOffer': { reason: 'child', note: 'belongs to a Quote' },
  'storefront.QuoteCounterOfferLine': { reason: 'child', note: 'belongs to a QuoteCounterOffer' },
  'tenant.TenantOrganization': { reason: 'root', note: 'the tenant profile; id is the tenant id' },
  'tenant.DiscountRedemption': { reason: 'child', note: 'belongs to a Discount' },
  'tenant.GiftCardTransaction': { reason: 'child', note: 'belongs to a GiftCard' },
  'tenant.LoyaltyTransaction': { reason: 'child', note: 'belongs to a LoyaltyAccount' },
  'tenant.SubscriptionLine': { reason: 'child', note: 'belongs to a Subscription' },
  'wms.PickLine': { reason: 'child', note: 'belongs to a PickTask' },
  'wms.ReceivingItem': { reason: 'child', note: 'belongs to a ReceivingSession' },
  'wms.CartonItem': { reason: 'child', note: 'belongs to a Carton' },
  'wms.CycleCountLine': { reason: 'child', note: 'belongs to a CycleCount' },
  'wms.PickWaveTask': { reason: 'child', note: 'belongs to a PickWave' },
  'wms.PutawayLine': { reason: 'child', note: 'belongs to a PutawayTask' },
}
