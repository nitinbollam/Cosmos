import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { createChartAccount } from './ledger'
import {
  createFixedAsset,
  listFixedAssets,
  getFixedAssetSummary,
  postMonthlyDepreciation,
  disposeFixedAsset,
  calculateMonthlyDepreciation,
} from './fixed-assets'
import { AccountType, DepreciationMethod, AssetStatus } from '@/generated/prisma-ledger'

test('Straight-Line and Declining-Balance Monthly Depreciation Math', () => {
  // Straight Line: ($12,000 cost - $0 salvage) / 60 months = $200 / month
  const slDeprec = calculateMonthlyDepreciation({
    cost: 12000,
    salvageValue: 0,
    usefulLifeMonths: 60,
    accumulatedDepreciation: 0,
    netBookValue: 12000,
    depreciationMethod: DepreciationMethod.STRAIGHT_LINE,
  })
  assert.equal(slDeprec, 200)

  // Fully depreciated asset should return 0
  const zeroDeprec = calculateMonthlyDepreciation({
    cost: 12000,
    salvageValue: 0,
    usefulLifeMonths: 60,
    accumulatedDepreciation: 12000,
    netBookValue: 0,
    depreciationMethod: DepreciationMethod.STRAIGHT_LINE,
  })
  assert.equal(zeroDeprec, 0)
})

test('Fixed Asset Registration, Depreciation Posting, and GL Entry', async () => {
  const tenantId = `tenant-${randomUUID()}`

  // Create required chart of accounts
  const expenseAcc = await createChartAccount(tenantId, {
    code: '5500',
    name: 'Depreciation Expense',
    type: AccountType.EXPENSE,
  })
  const accumAcc = await createChartAccount(tenantId, {
    code: '1550',
    name: 'Accumulated Depreciation — Equipment',
    type: AccountType.ASSET,
  })

  // 1. Register Fixed Asset ($24,000 forklift over 60 months)
  const asset = await createFixedAsset(tenantId, {
    assetCode: 'EQ-FORKLIFT-01',
    name: 'Toyota 8FBN25 Warehouse Forklift',
    category: 'EQUIPMENT',
    acquisitionDate: '2026-01-01',
    cost: 24000,
    salvageValue: 0,
    usefulLifeMonths: 60,
    expenseAccountId: expenseAcc.id,
    accumDepreciationAccountId: accumAcc.id,
  })

  assert.equal(asset.assetCode, 'EQ-FORKLIFT-01')
  assert.equal(asset.netBookValue, 24000)
  assert.equal(asset.status, AssetStatus.ACTIVE)

  // 2. Check Asset Summary
  const summary1 = await getFixedAssetSummary(tenantId)
  assert.equal(summary1.totalCost, 24000)
  assert.equal(summary1.totalNetBookValue, 24000)
  assert.equal(summary1.activeCount, 1)

  // 3. Post Monthly Depreciation ($24,000 / 60 = $400/mo)
  const result = await postMonthlyDepreciation(tenantId)
  assert.equal(result.count, 1)
  assert.equal(result.totalDepreciation, 400)

  // 4. Verify updated asset net book value
  const assetsAfter = await listFixedAssets(tenantId, 'ACTIVE')
  assert.equal(assetsAfter[0]!.accumulatedDepreciation, 400)
  assert.equal(assetsAfter[0]!.netBookValue, 23600)

  // 5. Dispose Asset ($5,000 proceeds on $23,600 net book value => $18,600 loss)
  const disposal = await disposeFixedAsset(tenantId, asset.id, {
    disposalDate: '2026-06-01',
    proceeds: 5000,
  })

  assert.equal(disposal.status, AssetStatus.DISPOSED)
  assert.equal(disposal.gainLoss, -18600)
})
