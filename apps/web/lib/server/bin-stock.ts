/**
 * Stock by bin (ticket 46). StockLevel holds the warehouse total for a SKU + batch; BinStock rows say how much of
 * it sits in each bin, and the rest is unbinned (received, waiting for putaway). Putaway and bin-to-bin moves shift
 * a quantity between bins and record it in the stock ledger as a pair of STOCK_MOVED rows (out of the source, into
 * the destination) in one transaction, so the total never changes and the ledger still sums to on-hand.
 */
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@/generated/prisma-inventory'
import { inventoryDb } from './db'
import { ApiError } from './session'

type Tx = Prisma.TransactionClient

export type MoveToBinInput = {
  skuId: string
  warehouseId: string
  batchId?: string | null
  /** Source bin; omitted or null takes unbinned stock (putaway). */
  fromBinId?: string | null
  toBinId: string
  quantity: number
  /** What caused the move. With `referenceId`, a repeat of the same move returns the first result. */
  referenceType: string
  referenceId?: string
  performedBy: string
  /** Move what is there when the source holds less than `quantity` (putaway after some stock already shipped). */
  allowPartial?: boolean
}

export type MoveToBinResult = { moved: number; replayed: boolean; binQuantity: number; unbinned: number }

/** Units of this stock level not in any bin. Never negative. */
export function unbinnedQuantity(onHand: number, bins: Array<{ quantity: number }>): number {
  return Math.max(0, onHand - bins.reduce((n, b) => n + b.quantity, 0))
}

/**
 * Bins lose stock when it leaves the warehouse without a bin move (shipments, transfers, write-offs). Which units
 * left: unbinned stock first, then the stock level's pick bin, then the fullest bins. Returns the reductions.
 */
export function binReductions(
  onHand: number,
  bins: Array<{ binId: string; quantity: number }>,
  pickBinId: string | null,
): Array<{ binId: string; take: number }> {
  let excess = bins.reduce((n, b) => n + b.quantity, 0) - Math.max(0, onHand)
  if (excess <= 0) return []
  const order = [...bins].sort((a, b) => {
    if (a.binId === pickBinId) return -1
    if (b.binId === pickBinId) return 1
    return b.quantity - a.quantity || a.binId.localeCompare(b.binId)
  })
  const out: Array<{ binId: string; take: number }> = []
  for (const b of order) {
    if (excess <= 0) break
    const take = Math.min(b.quantity, excess)
    if (take > 0) out.push({ binId: b.binId, take })
    excess -= take
  }
  return out
}

/** Keeps the bins of one stock level within its on-hand after stock left it. Call inside the same transaction. */
export async function trimBinsToOnHand(
  tx: Tx,
  tenantId: string,
  key: { skuId: string; warehouseId: string; batchId: string },
  onHand: number,
  pickBinId: string | null,
) {
  const bins = await tx.binStock.findMany({ where: { tenantId, ...key, quantity: { gt: 0 } }, select: { binId: true, quantity: true } })
  for (const r of binReductions(onHand, bins, pickBinId)) {
    await tx.binStock.updateMany({ where: { tenantId, ...key, binId: r.binId }, data: { quantity: { decrement: r.take } } })
  }
}

export async function moveToBin(tenantId: string, input: MoveToBinInput): Promise<MoveToBinResult> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new ApiError(400, 'Quantity to move must be a whole number above 0')
  if (input.fromBinId && input.fromBinId === input.toBinId) throw new ApiError(400, 'Source and destination bin are the same')
  const key = { skuId: input.skuId, warehouseId: input.warehouseId, batchId: input.batchId ?? '' }

  const bin = await inventoryDb.binLocation.findFirst({
    where: { id: input.toBinId, tenantId, warehouseId: input.warehouseId, isActive: true },
    select: { id: true },
  })
  if (!bin) throw new ApiError(400, 'Destination bin not found in this warehouse, or inactive')

  return inventoryDb.$transaction(async (tx) => {
    const binQty = async (binId: string) =>
      (await tx.binStock.findUnique({ where: { tenantId_skuId_warehouseId_batchId_binId: { tenantId, ...key, binId } } }))?.quantity ?? 0

    const level = await tx.stockLevel.findUnique({ where: { tenantId_skuId_warehouseId_batchId: { tenantId, ...key } } })
    if (!level) throw new ApiError(404, 'No stock of this item in this warehouse')
    const bins = await tx.binStock.findMany({ where: { tenantId, ...key }, select: { binId: true, quantity: true } })
    const unbinned = unbinnedQuantity(level.quantityOnHand, bins)

    if (input.referenceId) {
      const done = await tx.stockLedgerEntry.findFirst({
        where: { tenantId, eventType: 'STOCK_MOVED', referenceType: input.referenceType, referenceId: input.referenceId, quantityDelta: { gt: 0 } },
        select: { quantityDelta: true },
      })
      if (done) return { moved: done.quantityDelta, replayed: true, binQuantity: await binQty(input.toBinId), unbinned }
    }

    const available = input.fromBinId ? await binQty(input.fromBinId) : unbinned
    const moved = Math.min(input.quantity, available)
    if (moved < input.quantity && !input.allowPartial) {
      throw new ApiError(409, `Only ${available} unit(s) ${input.fromBinId ? 'in the source bin' : 'waiting for putaway'}; cannot move ${input.quantity}`)
    }

    if (moved > 0) {
      if (input.fromBinId) {
        const taken = await tx.binStock.updateMany({
          where: { tenantId, ...key, binId: input.fromBinId, quantity: { gte: moved } },
          data: { quantity: { decrement: moved } },
        })
        if (taken.count !== 1) throw new ApiError(409, 'The source bin changed while moving; try again')
      }
      await tx.binStock.upsert({
        where: { tenantId_skuId_warehouseId_batchId_binId: { tenantId, ...key, binId: input.toBinId } },
        update: { quantity: { increment: moved } },
        create: { tenantId, ...key, binId: input.toBinId, quantity: moved },
      })
      // The first bin a SKU is put into becomes its pick bin; later putaways don't move the whole level.
      if (!level.locationId) await tx.stockLevel.update({ where: { id: level.id }, data: { locationId: input.toBinId } })

      const correlationId = randomUUID()
      const row = {
        tenantId,
        skuId: key.skuId,
        warehouseId: key.warehouseId,
        batchId: key.batchId,
        eventType: 'STOCK_MOVED',
        quantityAfter: level.quantityOnHand,
        unitCost: '0',
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        performedBy: input.performedBy,
        correlationId,
      }
      await tx.stockLedgerEntry.create({ data: { ...row, id: randomUUID(), locationId: input.fromBinId ?? null, quantityDelta: -moved } })
      await tx.stockLedgerEntry.create({ data: { ...row, id: randomUUID(), locationId: input.toBinId, quantityDelta: moved } })
    }

    return {
      moved,
      replayed: false,
      binQuantity: await binQty(input.toBinId),
      unbinned: input.fromBinId ? unbinned : unbinned - moved,
    }
  })
}

/** What a bin holds, by SKU and batch. */
export function listBinStock(tenantId: string, binId: string) {
  return inventoryDb.binStock.findMany({ where: { tenantId, binId, quantity: { gt: 0 } }, orderBy: { skuId: 'asc' } })
}
