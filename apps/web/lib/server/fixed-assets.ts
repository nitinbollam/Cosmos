import { Prisma, AssetStatus, DepreciationMethod } from '@/generated/prisma-ledger'
import { ledgerDb } from './db'
import { createJournalDraft, postJournalEntry } from './ledger'
import { ApiError } from './session'

function toNum(v: unknown): number {
  if (v == null) return 0
  return Number(v)
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100
}

export type CreateFixedAssetInput = {
  assetCode: string
  name: string
  category?: string
  acquisitionDate: string
  cost: number
  salvageValue?: number
  usefulLifeMonths: number
  depreciationMethod?: DepreciationMethod
  assetAccountId?: string
  expenseAccountId?: string
  accumDepreciationAccountId?: string
}

export async function listFixedAssets(tenantId: string, status?: string) {
  const where: Prisma.FixedAssetWhereInput = { tenantId }
  if (status && status !== 'ALL') {
    where.status = status as AssetStatus
  }

  const assets = await ledgerDb.fixedAsset.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })

  return assets.map((a) => ({
    ...a,
    cost: toNum(a.cost),
    salvageValue: toNum(a.salvageValue),
    accumulatedDepreciation: toNum(a.accumulatedDepreciation),
    netBookValue: toNum(a.netBookValue),
    disposalProceeds: a.disposalProceeds != null ? toNum(a.disposalProceeds) : null,
  }))
}

export async function getFixedAsset(tenantId: string, id: string) {
  const row = await ledgerDb.fixedAsset.findFirst({
    where: { id, tenantId },
  })
  if (!row) throw new ApiError(404, 'Fixed asset not found')

  return {
    ...row,
    cost: toNum(row.cost),
    salvageValue: toNum(row.salvageValue),
    accumulatedDepreciation: toNum(row.accumulatedDepreciation),
    netBookValue: toNum(row.netBookValue),
    disposalProceeds: row.disposalProceeds != null ? toNum(row.disposalProceeds) : null,
  }
}

export async function createFixedAsset(tenantId: string, dto: CreateFixedAssetInput) {
  if (!dto.assetCode?.trim()) throw new ApiError(400, 'Asset code is required')
  if (!dto.name?.trim()) throw new ApiError(400, 'Asset name is required')
  if (!dto.cost || dto.cost <= 0) throw new ApiError(400, 'Acquisition cost must be greater than 0')
  if (!dto.usefulLifeMonths || dto.usefulLifeMonths < 1) {
    throw new ApiError(400, 'Useful life months must be at least 1')
  }

  const salvageValue = Math.max(0, dto.salvageValue ?? 0)
  if (salvageValue >= dto.cost) {
    throw new ApiError(400, 'Salvage value cannot equal or exceed cost')
  }

  const cost = roundMoney(dto.cost)
  const netBookValue = cost

  try {
    const asset = await ledgerDb.fixedAsset.create({
      data: {
        tenantId,
        assetCode: dto.assetCode.trim(),
        name: dto.name.trim(),
        category: dto.category?.trim() || 'EQUIPMENT',
        acquisitionDate: new Date(dto.acquisitionDate),
        cost: new Prisma.Decimal(cost),
        salvageValue: new Prisma.Decimal(salvageValue),
        usefulLifeMonths: dto.usefulLifeMonths,
        depreciationMethod: dto.depreciationMethod ?? DepreciationMethod.STRAIGHT_LINE,
        accumulatedDepreciation: new Prisma.Decimal(0),
        netBookValue: new Prisma.Decimal(netBookValue),
        status: AssetStatus.ACTIVE,
        assetAccountId: dto.assetAccountId?.trim() || undefined,
        expenseAccountId: dto.expenseAccountId?.trim() || undefined,
        accumDepreciationAccountId: dto.accumDepreciationAccountId?.trim() || undefined,
      },
    })

    return getFixedAsset(tenantId, asset.id)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ApiError(409, 'Asset code already exists')
    }
    throw e
  }
}

export async function getFixedAssetSummary(tenantId: string) {
  const assets = await ledgerDb.fixedAsset.findMany({
    where: { tenantId },
  })

  let totalCost = 0
  let totalAccumDeprec = 0
  let totalNetBookValue = 0
  let activeCount = 0

  for (const a of assets) {
    totalCost += toNum(a.cost)
    totalAccumDeprec += toNum(a.accumulatedDepreciation)
    totalNetBookValue += toNum(a.netBookValue)
    if (a.status === AssetStatus.ACTIVE) activeCount++
  }

  return {
    totalCost: roundMoney(totalCost),
    totalAccumDeprec: roundMoney(totalAccumDeprec),
    totalNetBookValue: roundMoney(totalNetBookValue),
    activeCount,
    totalCount: assets.length,
  }
}

export function calculateMonthlyDepreciation(asset: {
  cost: number
  salvageValue: number
  usefulLifeMonths: number
  accumulatedDepreciation: number
  netBookValue: number
  depreciationMethod: DepreciationMethod
}): number {
  if (asset.netBookValue <= asset.salvageValue) return 0

  const depreciableBasis = asset.cost - asset.salvageValue
  let monthlyAmount = 0

  if (asset.depreciationMethod === DepreciationMethod.DECLINING_BALANCE) {
    // 200% declining balance monthly rate
    const annualRate = 2 / (asset.usefulLifeMonths / 12)
    const monthlyRate = annualRate / 12
    monthlyAmount = asset.netBookValue * monthlyRate
  } else {
    // Straight-Line: (cost - salvage) / usefulLifeMonths
    monthlyAmount = depreciableBasis / asset.usefulLifeMonths
  }

  const remainingToDepreciate = asset.netBookValue - asset.salvageValue
  return roundMoney(Math.min(monthlyAmount, remainingToDepreciate))
}

export async function postMonthlyDepreciation(tenantId: string, dateStr?: string) {
  const activeAssets = await ledgerDb.fixedAsset.findMany({
    where: { tenantId, status: AssetStatus.ACTIVE },
  })

  if (activeAssets.length === 0) {
    return { count: 0, totalDepreciation: 0, journalEntries: [] }
  }

  // Find fallback GL accounts if specific asset GL mappings aren't provided
  const accounts = await ledgerDb.chartAccount.findMany({ where: { tenantId } })
  const defaultExpense = accounts.find((a) => a.code.startsWith('5') || a.name.toLowerCase().includes('depreciation'))?.id || accounts[0]?.id
  const defaultAccum = accounts.find((a) => a.code.startsWith('1') && a.name.toLowerCase().includes('accum'))?.id || accounts[0]?.id

  if (!defaultExpense || !defaultAccum) {
    throw new ApiError(400, 'Chart of accounts must contain accounts for depreciation GL posting')
  }

  let totalDepreciation = 0
  const journalEntries: string[] = []

  for (const rawAsset of activeAssets) {
    const asset = {
      cost: toNum(rawAsset.cost),
      salvageValue: toNum(rawAsset.salvageValue),
      usefulLifeMonths: rawAsset.usefulLifeMonths,
      accumulatedDepreciation: toNum(rawAsset.accumulatedDepreciation),
      netBookValue: toNum(rawAsset.netBookValue),
      depreciationMethod: rawAsset.depreciationMethod,
    }

    const monthlyAmount = calculateMonthlyDepreciation(asset)
    if (monthlyAmount <= 0) continue

    const newAccum = roundMoney(asset.accumulatedDepreciation + monthlyAmount)
    const newBookValue = roundMoney(asset.cost - newAccum)
    const isFullyDepreciated = newBookValue <= asset.salvageValue

    // 1. Update Asset records
    await ledgerDb.fixedAsset.update({
      where: { id: rawAsset.id },
      data: {
        accumulatedDepreciation: new Prisma.Decimal(newAccum),
        netBookValue: new Prisma.Decimal(newBookValue),
        status: isFullyDepreciated ? AssetStatus.FULLY_DEPRECIATED : AssetStatus.ACTIVE,
      },
    })

    // 2. Post Journal Entry
    const expenseAccountId = rawAsset.expenseAccountId || defaultExpense
    const accumAccountId = rawAsset.accumDepreciationAccountId || defaultAccum

    const draft = await createJournalDraft(tenantId, {
      description: `Monthly Depreciation — ${rawAsset.assetCode} (${rawAsset.name})`,
      lines: [
        { accountId: expenseAccountId, memo: `Depreciation expense for ${rawAsset.assetCode}`, debit: monthlyAmount, credit: 0 },
        { accountId: accumAccountId, memo: `Accumulated depreciation for ${rawAsset.assetCode}`, debit: 0, credit: monthlyAmount },
      ],
    })

    const posted = await postJournalEntry(tenantId, draft.id)
    journalEntries.push(posted.id)
    totalDepreciation += monthlyAmount
  }

  return {
    count: journalEntries.length,
    totalDepreciation: roundMoney(totalDepreciation),
    journalEntries,
  }
}

export async function disposeFixedAsset(
  tenantId: string,
  assetId: string,
  dto: { disposalDate?: string; proceeds?: number },
) {
  const asset = await getFixedAsset(tenantId, assetId)
  if (asset.status === AssetStatus.DISPOSED) {
    throw new ApiError(400, 'Asset is already disposed')
  }

  const proceeds = Math.max(0, roundMoney(dto.proceeds ?? 0))
  const netBookValue = asset.netBookValue
  const gainLoss = roundMoney(proceeds - netBookValue) // positive = gain, negative = loss

  const updated = await ledgerDb.fixedAsset.update({
    where: { id: assetId },
    data: {
      status: AssetStatus.DISPOSED,
      disposedAt: dto.disposalDate ? new Date(dto.disposalDate) : new Date(),
      disposalProceeds: new Prisma.Decimal(proceeds),
      netBookValue: new Prisma.Decimal(0),
    },
  })

  return {
    ...updated,
    cost: toNum(updated.cost),
    salvageValue: toNum(updated.salvageValue),
    accumulatedDepreciation: toNum(updated.accumulatedDepreciation),
    netBookValue: 0,
    disposalProceeds: proceeds,
    gainLoss,
  }
}
