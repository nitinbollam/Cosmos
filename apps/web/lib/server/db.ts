import { PrismaClient as AuthPrismaClient, Prisma as AuthPrisma } from '@/generated/prisma-auth'
import { PrismaClient as TenantPrismaClient, Prisma as TenantPrisma } from '@/generated/prisma-tenant'
import { PrismaClient as InventoryPrismaClient, Prisma as InventoryPrisma } from '@/generated/prisma-inventory'
import { PrismaClient as OrderPrismaClient, Prisma as OrderPrisma } from '@/generated/prisma-order'
import { PrismaClient as CrmPrismaClient, Prisma as CrmPrisma } from '@/generated/prisma-crm'
import { PrismaClient as StorefrontPrismaClient, Prisma as StorefrontPrisma } from '@/generated/prisma-storefront'
import { PrismaClient as WmsPrismaClient, Prisma as WmsPrisma } from '@/generated/prisma-wms'
import { PrismaClient as DispatchPrismaClient, Prisma as DispatchPrisma } from '@/generated/prisma-dispatch'
import { PrismaClient as PurchasingPrismaClient, Prisma as PurchasingPrisma } from '@/generated/prisma-purchasing'
import { PrismaClient as PaymentPrismaClient, Prisma as PaymentPrisma } from '@/generated/prisma-payment'
import { PrismaClient as CompliancePrismaClient, Prisma as CompliancePrisma } from '@/generated/prisma-compliance'
import { PrismaClient as NotificationPrismaClient, Prisma as NotificationPrisma } from '@/generated/prisma-notification'
import { PrismaClient as LedgerPrismaClient, Prisma as LedgerPrisma } from '@/generated/prisma-ledger'
import { PrismaClient as AnalyticsPrismaClient, Prisma as AnalyticsPrisma } from '@/generated/prisma-analytics'
import { PrismaClient as MarketplacePrismaClient, Prisma as MarketplacePrisma } from '@/generated/prisma-marketplace'
import { PrismaClient as SalesChannelsPrismaClient, Prisma as SalesChannelsPrisma } from '@/generated/prisma-sales-channels'

import { tenantModelsOf, withTenantScope } from './tenant-scope'

const globalDb = globalThis as unknown as {
  authDb?: AuthPrismaClient
  tenantDb?: TenantPrismaClient
  inventoryDb?: InventoryPrismaClient
  orderDb?: OrderPrismaClient
  crmDb?: CrmPrismaClient
  storefrontDb?: StorefrontPrismaClient
  wmsDb?: WmsPrismaClient
  dispatchDb?: DispatchPrismaClient
  purchasingDb?: PurchasingPrismaClient
  paymentDb?: PaymentPrismaClient
  complianceDb?: CompliancePrismaClient
  notificationDb?: NotificationPrismaClient
  ledgerDb?: LedgerPrismaClient
  analyticsDb?: AnalyticsPrismaClient
  marketplaceDb?: MarketplacePrismaClient
  salesChannelsDb?: SalesChannelsPrismaClient
}

export const authDb = globalDb.authDb ?? withTenantScope(new AuthPrismaClient(), 'auth', tenantModelsOf(AuthPrisma.dmmf))
export const tenantDb = globalDb.tenantDb ?? withTenantScope(new TenantPrismaClient(), 'tenant', tenantModelsOf(TenantPrisma.dmmf))
export const inventoryDb = globalDb.inventoryDb ?? withTenantScope(new InventoryPrismaClient(), 'inventory', tenantModelsOf(InventoryPrisma.dmmf))
export const orderDb = globalDb.orderDb ?? withTenantScope(new OrderPrismaClient(), 'order', tenantModelsOf(OrderPrisma.dmmf))
export const crmDb = globalDb.crmDb ?? withTenantScope(new CrmPrismaClient(), 'crm', tenantModelsOf(CrmPrisma.dmmf))
export const storefrontDb = globalDb.storefrontDb ?? withTenantScope(new StorefrontPrismaClient(), 'storefront', tenantModelsOf(StorefrontPrisma.dmmf))
export const wmsDb = globalDb.wmsDb ?? withTenantScope(new WmsPrismaClient(), 'wms', tenantModelsOf(WmsPrisma.dmmf))
export const dispatchDb = globalDb.dispatchDb ?? withTenantScope(new DispatchPrismaClient(), 'dispatch', tenantModelsOf(DispatchPrisma.dmmf))
export const purchasingDb = globalDb.purchasingDb ?? withTenantScope(new PurchasingPrismaClient(), 'purchasing', tenantModelsOf(PurchasingPrisma.dmmf))
export const paymentDb = globalDb.paymentDb ?? withTenantScope(new PaymentPrismaClient(), 'payment', tenantModelsOf(PaymentPrisma.dmmf))
export const complianceDb = globalDb.complianceDb ?? withTenantScope(new CompliancePrismaClient(), 'compliance', tenantModelsOf(CompliancePrisma.dmmf))
export const notificationDb = globalDb.notificationDb ?? withTenantScope(new NotificationPrismaClient(), 'notification', tenantModelsOf(NotificationPrisma.dmmf))
export const ledgerDb = globalDb.ledgerDb ?? withTenantScope(new LedgerPrismaClient(), 'ledger', tenantModelsOf(LedgerPrisma.dmmf))
export const analyticsDb = globalDb.analyticsDb ?? withTenantScope(new AnalyticsPrismaClient(), 'analytics', tenantModelsOf(AnalyticsPrisma.dmmf))
export const marketplaceDb = globalDb.marketplaceDb ?? withTenantScope(new MarketplacePrismaClient(), 'marketplace', tenantModelsOf(MarketplacePrisma.dmmf))
export const salesChannelsDb = globalDb.salesChannelsDb ?? withTenantScope(new SalesChannelsPrismaClient(), 'salesChannels', tenantModelsOf(SalesChannelsPrisma.dmmf))

if (process.env.NODE_ENV !== 'production') {
  globalDb.authDb = authDb
  globalDb.tenantDb = tenantDb
  globalDb.inventoryDb = inventoryDb
  globalDb.orderDb = orderDb
  globalDb.crmDb = crmDb
  globalDb.storefrontDb = storefrontDb
  globalDb.wmsDb = wmsDb
  globalDb.dispatchDb = dispatchDb
  globalDb.purchasingDb = purchasingDb
  globalDb.paymentDb = paymentDb
  globalDb.complianceDb = complianceDb
  globalDb.notificationDb = notificationDb
  globalDb.ledgerDb = ledgerDb
  globalDb.analyticsDb = analyticsDb
  globalDb.marketplaceDb = marketplaceDb
  globalDb.salesChannelsDb = salesChannelsDb
}
