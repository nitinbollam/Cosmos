import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { endOfWeek, format, startOfWeek, subWeeks } from 'date-fns'
import { complianceDb, crmDb, inventoryDb, orderDb, tenantDb } from './db'
import {
  buildTobFile,
  formatYmd,
  suggestTobFileName,
  type TobBidRow,
  type TobBuildInput,
  type TobCompanyProfile,
  type TobPurchaseRow,
  type TobStoreRow,
} from './msa-tob-format'
import { ApiError } from './session'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const reportDir = path.join(webRoot, '.data', 'msa-reports')

function ensureReportDir() {
  fs.mkdirSync(reportDir, { recursive: true })
}

function reporterNumberFromDid(reporterDid: string): string {
  const digits = reporterDid.replace(/\D/g, '')
  if (digits.length >= 8) return digits.slice(-8)
  let hash = 0
  for (const ch of reporterDid) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return String(hash % 100_000_000).padStart(8, '0')
}

function categoryCode(raw?: string | null): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (digits.length >= 6) return digits.slice(-6)
  return '003211'
}

function itemNoFromSku(code: string): string {
  const digits = code.replace(/\D/g, '')
  if (digits.length >= 4) return digits.slice(-4)
  return digits.padStart(4, '0') || '0000'
}

async function loadCompanyProfile(tenantId: string, reporterDid: string): Promise<TobCompanyProfile> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  const meta = (org?.metadata ?? {}) as Record<string, unknown>
  const msaMeta = (meta.msa ?? {}) as Record<string, unknown>
  const warehouse = await inventoryDb.warehouse.findFirst({
    where: { tenantId, isDefault: true },
    orderBy: { createdAt: 'asc' },
  })
  const whAddr = (warehouse?.address ?? {}) as Record<string, unknown>

  return {
    reporterNumber: String(msaMeta.reporterNumber ?? reporterNumberFromDid(reporterDid)),
    companyName: String(msaMeta.companyName ?? org?.displayName ?? 'Cosmos Distributor'),
    addressLine1: String(
      msaMeta.addressLine1 ?? whAddr.line1 ?? whAddr.street ?? '100 Distribution Way',
    ),
    city: String(msaMeta.city ?? whAddr.city ?? 'Charlotte'),
    state: String(msaMeta.state ?? whAddr.state ?? 'NC'),
    zip: String(msaMeta.zip ?? whAddr.postalCode ?? whAddr.zip ?? '28269'),
    country: String(msaMeta.country ?? whAddr.country ?? 'USA'),
    contactLast: String(msaMeta.contactLast ?? 'Admin'),
    contactFirst: String(msaMeta.contactFirst ?? 'Cosmos'),
    phone: String(msaMeta.phone ?? whAddr.phone ?? ''),
    fax: String(msaMeta.fax ?? ''),
    email: String(msaMeta.email ?? org?.billingEmail ?? 'compliance@cosmos.local'),
  }
}

async function buildTobPayload(
  tenantId: string,
  manufacturerDid: string,
  weekStart: Date,
  weekEnd: Date,
  reporterDid: string,
): Promise<TobBuildInput> {
  const profile = await loadCompanyProfile(tenantId, reporterDid)
  const weekEnding = formatYmd(weekEnd)

  const skus = await inventoryDb.sKU.findMany({
    where: {
      tenantId,
      isActive: true,
      OR: [{ manufacturerDid }, { isTobacco: true }],
    },
  })
  const skuById = new Map(skus.map((s) => [s.id, s]))

  const stockLevels = await inventoryDb.stockLevel.groupBy({
    by: ['skuId'],
    where: { tenantId, skuId: { in: skus.map((s) => s.id) } },
    _sum: { quantityOnHand: true },
  })
  const onHandBySku = new Map(stockLevels.map((r) => [r.skuId, r._sum.quantityOnHand ?? 0]))

  const txRows = await complianceDb.mSATransaction.findMany({
    where: {
      tenantId,
      manufacturerDid,
      transactionDate: { gte: weekStart, lte: weekEnd },
      isQualifying: true,
    },
  })
  const salesByUpc = new Map<string, number>()
  for (const tx of txRows) {
    salesByUpc.set(tx.upcCode, (salesByUpc.get(tx.upcCode) ?? 0) + tx.quantityPurchased)
  }

  const orders = await orderDb.order.findMany({
    where: {
      tenantId,
      createdAt: { gte: weekStart, lte: weekEnd },
      status: { notIn: ['CANCELLED', 'FAILED'] },
    },
    include: { lineItems: true },
  })

  for (const order of orders) {
    for (const line of order.lineItems) {
      const sku = skuById.get(line.skuId)
      if (!sku) continue
      const upc = (sku.barcode ?? sku.code).replace(/\D/g, '')
      salesByUpc.set(upc, (salesByUpc.get(upc) ?? 0) + line.quantity)
    }
  }

  const bids: TobBidRow[] = skus.map((sku) => {
    const upc = (sku.barcode ?? sku.code).replace(/\D/g, '') || sku.code
    return {
      upc,
      itemNo: itemNoFromSku(sku.code),
      description: sku.name,
      onHand: onHandBySku.get(sku.id) ?? 0,
      category: categoryCode(sku.exciseTaxCategory ?? sku.category),
      salesQty: salesByUpc.get(upc.replace(/\D/g, '')) ?? 0,
      field6: 0,
    }
  })

  if (bids.length === 0 && txRows.length > 0) {
    const seen = new Set<string>()
    for (const tx of txRows) {
      if (seen.has(tx.upcCode)) continue
      seen.add(tx.upcCode)
      bids.push({
        upc: tx.upcCode,
        itemNo: itemNoFromSku(tx.upcCode),
        description: `UPC ${tx.upcCode}`,
        onHand: 0,
        category: '003211',
        salesQty: salesByUpc.get(tx.upcCode.replace(/\D/g, '')) ?? tx.quantityPurchased,
        field6: 0,
      })
    }
  }

  const customers = await crmDb.customer.findMany({ where: { tenantId } })
  const customerById = new Map(customers.map((c) => [c.id, c]))
  const storeMap = new Map<string, TobStoreRow>()
  const purchases: TobPurchaseRow[] = []

  for (const order of orders) {
    const customer = customerById.get(order.customerId)
    const storeId = (customer?.externalRef ?? customer?.id ?? order.customerId).replace(/\s/g, '').slice(0, 8) || '1'
    if (!storeMap.has(storeId)) {
      storeMap.set(storeId, {
        storeId,
        name: customer?.name ?? `Customer ${storeId}`,
        addressLine1: customer?.primaryAddressLine1 ?? 'Unknown address',
        city: customer?.primaryCity ?? 'Unknown',
        state: customer?.primaryState ?? 'NC',
        zip: customer?.primaryZip ?? '00000',
        country: 'USA',
        phone: customer?.phone ?? undefined,
      })
    }

    for (const line of order.lineItems) {
      const sku = skuById.get(line.skuId)
      if (!sku) continue
      if (sku.manufacturerDid && sku.manufacturerDid !== manufacturerDid) continue
      purchases.push({
        storeId,
        itemNo: itemNoFromSku(sku.code),
        orderNumber: order.id.startsWith('seed_') ? `SO-${format(order.createdAt, 'yyMMdd')}-${order.id.slice(-5)}` : order.id.slice(0, 20),
        transactionDate: formatYmd(order.createdAt),
        quantity: line.quantity,
        lineAmount: Number(line.unitPrice) * line.quantity,
      })
    }
  }

  return {
    profile,
    weekEnding,
    bids,
    stores: Array.from(storeMap.values()),
    purchases,
  }
}

export async function listReports(tenantId: string, status?: string) {
  return complianceDb.mSAReport.findMany({
    where: {
      tenantId,
      ...(status
        ? { status: status as 'GENERATED' | 'SUBMITTED' | 'SUBMISSION_FAILED' | 'ACCEPTED' }
        : {}),
    },
    orderBy: { weekEnding: 'desc' },
    take: 100,
  })
}

export async function getReport(tenantId: string, id: string) {
  const row = await complianceDb.mSAReport.findFirst({ where: { id, tenantId } })
  if (!row) throw new ApiError(404, 'Report not found')
  return row
}

export async function readReportFile(tenantId: string, id: string): Promise<{ fileName: string; content: string }> {
  const row = await getReport(tenantId, id)
  const abs = path.join(reportDir, `${row.id}.tob`)
  if (!fs.existsSync(abs)) {
    throw new ApiError(404, 'Report file not found on disk — regenerate the report')
  }
  const content = fs.readFileSync(abs, 'utf8')
  const fileName = path.basename(row.filePath) || `${row.id}.tob`
  return { fileName, content }
}

export async function getConfig(tenantId: string) {
  return complianceDb.mSATenant.findFirst({
    where: { tenantId },
    include: { manufacturerDids: { where: { isActive: true } } },
  })
}

export type UpsertMsaConfigInput = {
  reporterDid: string
  msaEnabled?: boolean
  manufacturerDid: string
  manufacturerName: string
  ediEndpoint?: string
  autoSubmit?: boolean
  reporterNumber?: string
  companyName?: string
  addressLine1?: string
  city?: string
  state?: string
  zip?: string
  phone?: string
  email?: string
}

export async function upsertConfig(tenantId: string, dto: UpsertMsaConfigInput) {
  let row = await complianceDb.mSATenant.findFirst({ where: { tenantId } })
  if (!row) {
    await complianceDb.mSATenant.create({
      data: {
        tenantId,
        reporterDid: dto.reporterDid,
        msaEnabled: dto.msaEnabled ?? true,
        manufacturerDids: {
          create: {
            reporterDid: dto.reporterDid,
            manufacturerDid: dto.manufacturerDid,
            manufacturerName: dto.manufacturerName,
            ediEndpoint: dto.ediEndpoint,
            ediCredentials: {},
            autoSubmit: dto.autoSubmit ?? false,
          },
        },
      },
    })
  } else {
    await complianceDb.mSATenant.update({
      where: { id: row.id },
      data: {
        reporterDid: dto.reporterDid,
        ...(dto.msaEnabled !== undefined ? { msaEnabled: dto.msaEnabled } : {}),
      },
    })
    await complianceDb.mSAManufacturerDid.upsert({
      where: {
        msaTenantId_manufacturerDid: { msaTenantId: row.id, manufacturerDid: dto.manufacturerDid },
      },
      create: {
        msaTenantId: row.id,
        reporterDid: dto.reporterDid,
        manufacturerDid: dto.manufacturerDid,
        manufacturerName: dto.manufacturerName,
        ediEndpoint: dto.ediEndpoint,
        ediCredentials: {},
        autoSubmit: dto.autoSubmit ?? false,
      },
      update: {
        reporterDid: dto.reporterDid,
        manufacturerName: dto.manufacturerName,
        ediEndpoint: dto.ediEndpoint,
        ...(dto.autoSubmit !== undefined ? { autoSubmit: dto.autoSubmit } : {}),
        isActive: true,
      },
    })
  }

  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  const meta = (org?.metadata ?? {}) as Record<string, unknown>
  const msaMeta = {
    ...(meta.msa as Record<string, unknown> | undefined),
    ...(dto.reporterNumber ? { reporterNumber: dto.reporterNumber } : {}),
    ...(dto.companyName ? { companyName: dto.companyName } : {}),
    ...(dto.addressLine1 ? { addressLine1: dto.addressLine1 } : {}),
    ...(dto.city ? { city: dto.city } : {}),
    ...(dto.state ? { state: dto.state } : {}),
    ...(dto.zip ? { zip: dto.zip } : {}),
    ...(dto.phone ? { phone: dto.phone } : {}),
    ...(dto.email ? { email: dto.email } : {}),
  }
  if (Object.keys(msaMeta).length > 0) {
    await tenantDb.tenantOrganization.update({
      where: { id: tenantId },
      data: { metadata: { ...meta, msa: msaMeta } },
    })
  }

  return getConfig(tenantId)
}

export type MsaTransactionImportRow = {
  manufacturerDid: string
  upcCode: string
  transactionDate: string
  quantityPurchased: number
  cartonCount: number
  netAmount: number
  returnAmount?: number
  isQualifying?: boolean
  orderId?: string
  poId?: string
}

export async function importTransactions(tenantId: string, rows: MsaTransactionImportRow[]) {
  let created = 0
  const errors: Array<{ row: number; message: string }> = []
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const rowNum = index + 2
    try {
      await complianceDb.mSATransaction.create({
        data: {
          tenantId,
          manufacturerDid: row.manufacturerDid,
          upcCode: row.upcCode,
          transactionDate: new Date(row.transactionDate),
          quantityPurchased: row.quantityPurchased,
          cartonCount: row.cartonCount,
          netAmount: row.netAmount,
          returnAmount: row.returnAmount ?? 0,
          isQualifying: row.isQualifying ?? true,
          orderId: row.orderId,
          poId: row.poId,
        },
      })
      created++
    } catch (e) {
      errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : 'Could not create transaction',
      })
    }
  }
  return { created, failed: errors.length, errors }
}

export async function generateReportForTenant(tenantId: string, weekOffset = 0): Promise<string[]> {
  const targetWeekEnd = endOfWeek(subWeeks(new Date(), weekOffset + 1), { weekStartsOn: 1 })
  const targetWeekStart = startOfWeek(subWeeks(new Date(), weekOffset + 1), { weekStartsOn: 1 })

  const tenantConfig = await complianceDb.mSATenant.findFirst({
    where: { tenantId, isActive: true },
    include: { manufacturerDids: { where: { isActive: true } } },
  })
  if (!tenantConfig) throw new ApiError(400, `MSA config not found for ${tenantId}`)

  ensureReportDir()
  const reports: string[] = []

  for (const didConfig of tenantConfig.manufacturerDids) {
    const payload = await buildTobPayload(
      tenantId,
      didConfig.manufacturerDid,
      targetWeekStart,
      targetWeekEnd,
      tenantConfig.reporterDid,
    )

    if (payload.bids.length === 0 && payload.purchases.length === 0) continue

    const fileContent = buildTobFile(payload)
    const fileHash = createHash('sha256').update(fileContent).digest('hex')
    const reportId = randomUUID()
    const fileName = suggestTobFileName(targetWeekEnd)
    const absPath = path.join(reportDir, `${reportId}.tob`)
    fs.writeFileSync(absPath, fileContent, 'utf8')

    const transactions = await complianceDb.mSATransaction.findMany({
      where: {
        tenantId,
        manufacturerDid: didConfig.manufacturerDid,
        transactionDate: { gte: targetWeekStart, lte: targetWeekEnd },
        isQualifying: true,
      },
    })

    const netPurchases = payload.purchases.reduce((s, p) => s + p.lineAmount, 0)

    await complianceDb.mSAReport.create({
      data: {
        id: reportId,
        tenantId,
        reporterDid: didConfig.reporterDid,
        manufacturerDid: didConfig.manufacturerDid,
        weekEnding: targetWeekEnd,
        weekStart: targetWeekStart,
        filePath: fileName,
        fileHash,
        totalTransactions: Math.max(transactions.length, payload.purchases.length),
        netPurchases,
        status: 'GENERATED',
      },
    })

    reports.push(reportId)
  }

  if (reports.length === 0) {
    throw new ApiError(
      400,
      'No TOB report data for this period — add tobacco SKUs, orders, or import MSA transactions first',
    )
  }

  return reports
}