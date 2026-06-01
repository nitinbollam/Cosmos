import { Prisma } from '@/generated/prisma-storefront'
import { storefrontDb } from './db'
import { ApiError } from './session'

export async function listOrderTemplates(tenantId: string, customerRef: string) {
  return storefrontDb.orderTemplate.findMany({
    where: { tenantId, customerRef },
    include: { lines: true },
    orderBy: { updatedAt: 'desc' },
  })
}

export async function createOrderTemplate(
  tenantId: string,
  dto: { customerRef: string; name: string; lines: Array<{ skuId: string; quantity: number }> },
  opts?: { buyerCustomerId?: string },
) {
  if (opts?.buyerCustomerId && dto.customerRef !== opts.buyerCustomerId) {
    throw new ApiError(403, 'Cannot create templates for another customer')
  }
  if (!dto.name.trim()) throw new ApiError(400, 'name required')
  if (dto.lines.length === 0) throw new ApiError(400, 'At least one line required')

  return storefrontDb.orderTemplate.create({
    data: {
      tenantId,
      customerRef: dto.customerRef,
      name: dto.name.trim(),
      lines: { create: dto.lines.map((l) => ({ skuId: l.skuId, quantity: l.quantity })) },
    },
    include: { lines: true },
  })
}

export async function deleteOrderTemplate(tenantId: string, id: string, opts?: { buyerCustomerId?: string }) {
  const row = await storefrontDb.orderTemplate.findFirst({ where: { id, tenantId } })
  if (!row) throw new ApiError(404, 'Template not found')
  if (opts?.buyerCustomerId && row.customerRef !== opts.buyerCustomerId) {
    throw new ApiError(404, 'Template not found')
  }
  await storefrontDb.orderTemplate.delete({ where: { id } })
  return { deleted: true }
}

export async function templateToCartLines(tenantId: string, templateId: string, customerId: string) {
  const template = await storefrontDb.orderTemplate.findFirst({
    where: { id: templateId, tenantId, customerRef: customerId },
    include: { lines: true },
  })
  if (!template) throw new ApiError(404, 'Template not found')

  const { resolvePricesForCustomer } = await import('./pricing')
  const { inventoryDb } = await import('./db')
  const skuIds = template.lines.map((l) => l.skuId)
  const warehouses = await inventoryDb.warehouse.findMany({ where: { tenantId, isActive: true } })
  const defaultWh = warehouses.find((w) => w.isDefault) ?? warehouses[0]
  if (!defaultWh) throw new ApiError(400, 'No warehouse configured')

  const [prices, skus] = await Promise.all([
    resolvePricesForCustomer(tenantId, customerId, skuIds),
    inventoryDb.sKU.findMany({ where: { tenantId, id: { in: skuIds } }, select: { id: true, code: true, name: true } }),
  ])
  const skuMap = new Map(skus.map((s) => [s.id, s]))

  return template.lines.map((l) => {
    const price = prices.get(l.skuId)
    const sku = skuMap.get(l.skuId)
    return {
      skuId: l.skuId,
      skuCode: sku?.code ?? l.skuId,
      skuName: sku?.name ?? 'Item',
      name: sku?.name ?? 'Item',
      quantity: l.quantity,
      unitPrice: price?.unitPrice ?? 0,
      warehouseId: defaultWh.id,
    }
  })
}
