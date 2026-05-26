import { PrismaClient as AuthPrismaClient } from '@/generated/prisma-auth'
import { PrismaClient as TenantPrismaClient } from '@/generated/prisma-tenant'
import { PrismaClient as InventoryPrismaClient } from '@/generated/prisma-inventory'
import { PrismaClient as OrderPrismaClient } from '@/generated/prisma-order'
import { PrismaClient as CrmPrismaClient } from '@/generated/prisma-crm'
import { PrismaClient as StorefrontPrismaClient } from '@/generated/prisma-storefront'
import { PrismaClient as WmsPrismaClient } from '@/generated/prisma-wms'
import { PrismaClient as DispatchPrismaClient } from '@/generated/prisma-dispatch'
import { PrismaClient as PurchasingPrismaClient } from '@/generated/prisma-purchasing'
import { PrismaClient as PaymentPrismaClient } from '@/generated/prisma-payment'
import { PrismaClient as CompliancePrismaClient } from '@/generated/prisma-compliance'
import { PrismaClient as NotificationPrismaClient } from '@/generated/prisma-notification'
import { PrismaClient as LedgerPrismaClient } from '@/generated/prisma-ledger'
import { PrismaClient as AnalyticsPrismaClient } from '@/generated/prisma-analytics'

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
}

export const authDb = globalDb.authDb ?? new AuthPrismaClient()
export const tenantDb = globalDb.tenantDb ?? new TenantPrismaClient()
export const inventoryDb = globalDb.inventoryDb ?? new InventoryPrismaClient()
export const orderDb = globalDb.orderDb ?? new OrderPrismaClient()
export const crmDb = globalDb.crmDb ?? new CrmPrismaClient()
export const storefrontDb = globalDb.storefrontDb ?? new StorefrontPrismaClient()
export const wmsDb = globalDb.wmsDb ?? new WmsPrismaClient()
export const dispatchDb = globalDb.dispatchDb ?? new DispatchPrismaClient()
export const purchasingDb = globalDb.purchasingDb ?? new PurchasingPrismaClient()
export const paymentDb = globalDb.paymentDb ?? new PaymentPrismaClient()
export const complianceDb = globalDb.complianceDb ?? new CompliancePrismaClient()
export const notificationDb = globalDb.notificationDb ?? new NotificationPrismaClient()
export const ledgerDb = globalDb.ledgerDb ?? new LedgerPrismaClient()
export const analyticsDb = globalDb.analyticsDb ?? new AnalyticsPrismaClient()

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
}
