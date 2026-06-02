import { Prisma } from '@/generated/prisma-crm'
import { crmDb, inventoryDb } from './db'
import { ApiError } from './session'

function toNum(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v == null) return 0
  return Number(v)
}

export async function listCustomerPrices(tenantId: string, customerId: string) {
  const rows = await crmDb.customerPrice.findMany({
    where: { tenantId, customerId },
    orderBy: { updatedAt: 'desc' },
  })
  const skuIds = [...new Set(rows.map((r) => r.skuId))]
  const skus =
    skuIds.length > 0
      ? await inventoryDb.sKU.findMany({ where: { tenantId, id: { in: skuIds } }, select: { id: true, code: true, name: true, price: true } })
      : []
  const skuMap = new Map(skus.map((s) => [s.id, s]))
  return rows.map((r) => ({
    ...r,
    sku: skuMap.get(r.skuId) ?? null,
    listPrice: skuMap.get(r.skuId)?.price ?? null,
  }))
}

export type UpsertCustomerPriceInput = {
  skuId: string
  unitPrice: number
  notes?: string
  effectiveFrom?: string
  effectiveTo?: string | null
}

export async function upsertCustomerPrice(tenantId: string, customerId: string, dto: UpsertCustomerPriceInput) {
  if (!dto.skuId?.trim()) throw new ApiError(400, 'skuId required')
  if (!Number.isFinite(dto.unitPrice) || dto.unitPrice < 0) throw new ApiError(400, 'unitPrice must be >= 0')
  const sku = await inventoryDb.sKU.findFirst({ where: { id: dto.skuId, tenantId } })
  if (!sku) throw new ApiError(404, 'SKU not found')

  return crmDb.customerPrice.upsert({
    where: { tenantId_customerId_skuId: { tenantId, customerId, skuId: dto.skuId } },
    create: {
      tenantId,
      customerId,
      skuId: dto.skuId,
      unitPrice: new Prisma.Decimal(dto.unitPrice),
      notes: dto.notes,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
    },
    update: {
      unitPrice: new Prisma.Decimal(dto.unitPrice),
      notes: dto.notes,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
      effectiveTo: dto.effectiveTo === null ? null : dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
    },
  })
}

export async function deleteCustomerPrice(tenantId: string, customerId: string, skuId: string) {
  const row = await crmDb.customerPrice.findFirst({ where: { tenantId, customerId, skuId } })
  if (!row) throw new ApiError(404, 'Contract price not found')
  await crmDb.customerPrice.delete({ where: { id: row.id } })
  return { deleted: true }
}

export type ResolvedPrice = { unitPrice: number; source: 'list' | 'contract'; minPrice?: number }

export async function resolvePricesForCustomer(
  tenantId: string,
  customerId: string,
  skuIds: string[],
  quantities?: Map<string, number>,
) {
  if (skuIds.length === 0) return new Map<string, ResolvedPrice>()
  const now = new Date()
  const contracts = await crmDb.customerPrice.findMany({
    where: {
      tenantId,
      customerId,
      skuId: { in: skuIds },
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
  })
  const contractMap = new Map(contracts.map((c) => [c.skuId, toNum(c.unitPrice)]))

  const volumeBreaks = await crmDb.volumePriceBreak.findMany({
    where: {
      tenantId,
      skuId: { in: skuIds },
      OR: [{ customerId: null }, { customerId }],
    },
    orderBy: { minQty: 'desc' },
  })

  const skus = await inventoryDb.sKU.findMany({
    where: { tenantId, id: { in: skuIds } },
    select: { id: true, price: true, minPrice: true },
  })
  const result = new Map<string, ResolvedPrice>()
  for (const sku of skus) {
    const qty = quantities?.get(sku.id) ?? 1
    const volume = volumeBreaks.find((b) => b.skuId === sku.id && qty >= b.minQty && (!b.customerId || b.customerId === customerId))
    if (volume) {
      result.set(sku.id, {
        unitPrice: toNum(volume.unitPrice),
        source: 'contract',
        minPrice: sku.minPrice != null ? toNum(sku.minPrice) : undefined,
      })
      continue
    }
    const contract = contractMap.get(sku.id)
    if (contract != null) {
      result.set(sku.id, { unitPrice: contract, source: 'contract', minPrice: sku.minPrice != null ? toNum(sku.minPrice) : undefined })
    } else {
      result.set(sku.id, { unitPrice: toNum(sku.price), source: 'list', minPrice: sku.minPrice != null ? toNum(sku.minPrice) : undefined })
    }
  }
  return result
}

export async function resolveUnitPrice(tenantId: string, customerId: string, skuId: string): Promise<number> {
  const map = await resolvePricesForCustomer(tenantId, customerId, [skuId])
  const row = map.get(skuId)
  if (!row) {
    const sku = await inventoryDb.sKU.findFirst({ where: { id: skuId, tenantId } })
    if (!sku) throw new ApiError(404, 'SKU not found')
    return toNum(sku.price)
  }
  return row.unitPrice
}

export async function assertOrderLinePrices(
  tenantId: string,
  customerId: string,
  lines: Array<{ skuId: string; unitPrice: number }>,
) {
  const skuIds = lines.map((l) => l.skuId)
  const prices = await resolvePricesForCustomer(tenantId, customerId, skuIds)
  for (const line of lines) {
    const resolved = prices.get(line.skuId)
    if (!resolved) throw new ApiError(400, `Unknown SKU ${line.skuId}`)
    const expected = resolved.unitPrice
    if (Math.abs(line.unitPrice - expected) > 0.02) {
      throw new ApiError(400, `Price mismatch for SKU ${line.skuId}: expected ${expected.toFixed(2)}`)
    }
    if (resolved.minPrice != null && line.unitPrice < resolved.minPrice - 0.001) {
      throw new ApiError(400, `Price below minimum for SKU ${line.skuId}`)
    }
  }
}

export async function enrichSkusWithCustomerPrices<T extends { id: string; price: Prisma.Decimal | number }>(
  tenantId: string,
  customerId: string | undefined,
  skus: T[],
) {
  if (!customerId || skus.length === 0) return skus
  const priceMap = await resolvePricesForCustomer(
    tenantId,
    customerId,
    skus.map((s) => s.id),
  )
  return skus.map((sku) => {
    const resolved = priceMap.get(sku.id)
    if (!resolved || resolved.source === 'list') return sku
    return {
      ...sku,
      price: resolved.unitPrice,
      listPrice: toNum(sku.price),
      contractPrice: resolved.unitPrice,
      priceSource: 'contract' as const,
    }
  })
}

export async function listVolumePriceBreaks(tenantId: string, skuId?: string, customerId?: string) {
  return crmDb.volumePriceBreak.findMany({
    where: {
      tenantId,
      ...(skuId ? { skuId } : {}),
      ...(customerId ? { OR: [{ customerId: null }, { customerId }] } : {}),
    },
    orderBy: [{ skuId: 'asc' }, { minQty: 'asc' }],
  })
}

export async function upsertVolumePriceBreak(
  tenantId: string,
  dto: { skuId: string; minQty: number; unitPrice: number; customerId?: string | null },
) {
  if (dto.minQty < 1) throw new ApiError(400, 'minQty must be >= 1')
  const existing = await crmDb.volumePriceBreak.findFirst({
    where: { tenantId, skuId: dto.skuId, customerId: dto.customerId ?? null, minQty: dto.minQty },
  })
  if (existing) {
    return crmDb.volumePriceBreak.update({
      where: { id: existing.id },
      data: { unitPrice: new Prisma.Decimal(dto.unitPrice) },
    })
  }
  return crmDb.volumePriceBreak.create({
    data: {
      tenantId,
      skuId: dto.skuId,
      customerId: dto.customerId ?? null,
      minQty: dto.minQty,
      unitPrice: new Prisma.Decimal(dto.unitPrice),
    },
  })
}
