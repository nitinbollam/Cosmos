import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { ledgerDb, purchasingDb } from './db'
import { trialBalance, createChartAccount } from './ledger'
import { listVendorBills } from './ap-bills'
import { createBankAccount, importStatementLines, getReconciliationSummary } from './bank-recon'
import { AccountType } from '@/generated/prisma-ledger'
import { VendorBillStatus } from '@/generated/prisma-purchasing'

test('Trial Balance Monthly, Quarterly, and Yearly Views', async () => {
  const tenantId = `tenant-${randomUUID()}`

  // Create accounts
  const asset = await createChartAccount(tenantId, { code: '1000', name: 'Cash', type: AccountType.ASSET })
  const rev = await createChartAccount(tenantId, { code: '4000', name: 'Revenue', type: AccountType.REVENUE })

  // Create posted journal entry in Q1 (Feb 15)
  await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: 'Q1 Sale',
      isPosted: true,
      postedAt: new Date(2026, 1, 15), // Feb 15, 2026
      lines: {
        create: [
          { accountId: asset.id, debit: 500, credit: 0 },
          { accountId: rev.id, debit: 0, credit: 500 },
        ],
      },
    },
  })

  // Create posted journal entry in Q3 (Aug 10)
  await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: 'Q3 Sale',
      isPosted: true,
      postedAt: new Date(2026, 7, 10), // Aug 10, 2026
      lines: {
        create: [
          { accountId: asset.id, debit: 300, credit: 0 },
          { accountId: rev.id, debit: 0, credit: 300 },
        ],
      },
    },
  })

  // Monthly Trial Balance for Feb 2026
  const febTb = await trialBalance(tenantId, 2026, { year: 2026, periodType: 'MONTHLY', month: 2 })
  assert.equal(febTb.length, 2)
  const febCash = febTb.find((r) => r.accountCode === '1000')
  assert.equal(febCash?.debits, 500)

  // Quarterly Trial Balance for Q1 2026
  const q1Tb = await trialBalance(tenantId, 2026, { year: 2026, periodType: 'QUARTERLY', quarter: 1 })
  assert.equal(q1Tb.length, 2)
  const q1Cash = q1Tb.find((r) => r.accountCode === '1000')
  assert.equal(q1Cash?.debits, 500)

  // Quarterly Trial Balance for Q2 2026 (No transactions)
  const q2Tb = await trialBalance(tenantId, 2026, { year: 2026, periodType: 'QUARTERLY', quarter: 2 })
  assert.equal(q2Tb.length, 0)

  // Yearly Trial Balance for 2026 (Sums Q1 + Q3)
  const yearlyTb = await trialBalance(tenantId, 2026, { year: 2026, periodType: 'YEARLY' })
  assert.equal(yearlyTb.length, 2)
  const yearlyCash = yearlyTb.find((r) => r.accountCode === '1000')
  assert.equal(yearlyCash?.debits, 800)
})

test('AP Bills Date Range Filtering', async () => {
  const tenantId = `tenant-${randomUUID()}`
  const supplier = await purchasingDb.supplier.create({
    data: {
      tenantId,
      code: 'SUP-001',
      name: 'Acme Test Supplier',
    },
  })

  // Create bills with different issue dates
  await purchasingDb.vendorBill.create({
    data: {
      id: randomUUID(),
      tenantId,
      supplierId: supplier.id,
      billNumber: 'BILL-FEB-001',
      status: 'ISSUED' as VendorBillStatus,
      subtotal: 100,
      totalAmount: 100,
      amountPaid: 0,
      issuedAt: new Date('2026-02-10T10:00:00Z'),
    },
  })

  await purchasingDb.vendorBill.create({
    data: {
      id: randomUUID(),
      tenantId,
      supplierId: supplier.id,
      billNumber: 'BILL-MAR-001',
      status: 'ISSUED' as VendorBillStatus,
      subtotal: 200,
      totalAmount: 200,
      amountPaid: 0,
      issuedAt: new Date('2026-03-15T10:00:00Z'),
    },
  })

  // Filter bills in February 2026
  const febBills = await listVendorBills(tenantId, 'ALL', {
    startDate: '2026-02-01',
    endDate: '2026-02-28',
  })
  assert.equal(febBills.length, 1)
  assert.equal(febBills[0]!.billNumber, 'BILL-FEB-001')
})

test('Bank Reconciliation Debit/Credit Metrics', async () => {
  const tenantId = `tenant-${randomUUID()}`
  const bank = await createBankAccount(tenantId, { name: 'Operating Account', openingBalance: 1000 })

  await importStatementLines(tenantId, bank.id, [
    { postedAt: '2026-02-01', description: 'Customer Direct Deposit', amount: 500 }, // Debit (+)
    { postedAt: '2026-02-05', description: 'Vendor Payment', amount: -200 }, // Credit (-)
  ])

  const summary = await getReconciliationSummary(tenantId, {
    startDate: '2026-02-01',
    endDate: '2026-02-28',
  })

  assert.equal(summary.totalDebits, 500)
  assert.equal(summary.totalCredits, 200)
  assert.equal(summary.closingBalanceTotal, 1000)
})
