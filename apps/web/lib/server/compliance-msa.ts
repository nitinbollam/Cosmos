import { createHash, randomUUID } from 'node:crypto'
import { endOfWeek, format, startOfWeek, subWeeks } from 'date-fns'
import { complianceDb } from './db'
import { ApiError } from './session'

interface MulticatRecord {
  reporterDid: string
  manufacturerDid: string
  weekEnding: string
  upcCode: string
  quantity: number
  cartonCount: number
  netPurchases: number
  returns: number
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
    include: { manufacturerDids: true },
  })
  if (!tenantConfig) throw new ApiError(400, `MSA config not found for ${tenantId}`)

  const reports: string[] = []

  for (const didConfig of tenantConfig.manufacturerDids) {
    const reportId = randomUUID()
    const transactions = await complianceDb.mSATransaction.findMany({
      where: {
        tenantId,
        manufacturerDid: didConfig.manufacturerDid,
        transactionDate: { gte: targetWeekStart, lte: targetWeekEnd },
        isQualifying: true,
      },
    })
    if (transactions.length === 0) continue

    const aggregated = new Map<string, MulticatRecord>()

    for (const tx of transactions) {
      const key = `${didConfig.reporterDid}|${tx.upcCode}`
      const existing = aggregated.get(key)
      if (existing) {
        existing.quantity += tx.quantityPurchased
        existing.cartonCount += tx.cartonCount
        existing.netPurchases += Number(tx.netAmount)
        existing.returns += Number(tx.returnAmount)
      } else {
        aggregated.set(key, {
          reporterDid: didConfig.reporterDid,
          manufacturerDid: didConfig.manufacturerDid,
          weekEnding: format(targetWeekEnd, 'yyyyMMdd'),
          upcCode: tx.upcCode,
          quantity: tx.quantityPurchased,
          cartonCount: tx.cartonCount,
          netPurchases: Number(tx.netAmount),
          returns: Number(tx.returnAmount),
        })
      }
    }

    const records = Array.from(aggregated.values())
    const fileContent = buildMulticatFile(records, didConfig)
    const fileHash = createHash('sha256').update(fileContent).digest('hex')
    const fileName = `msa/${tenantId}/${didConfig.manufacturerDid}/MULTICAT_${format(targetWeekEnd, 'yyyyMMdd')}_${reportId}.txt`

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
        totalTransactions: transactions.length,
        netPurchases: transactions.reduce((s, t) => s + Number(t.netAmount), 0),
        status: 'GENERATED',
      },
    })

    reports.push(reportId)
  }

  return reports
}

function buildMulticatFile(
  records: MulticatRecord[],
  didConfig: { reporterDid: string; manufacturerDid: string },
): string {
  const header = `HDR|${didConfig.reporterDid}|${records[0]?.weekEnding ?? ''}|MULTICAT|1.0\n`
  const lines = records.map((r) =>
    [
      'DTL',
      r.reporterDid,
      r.manufacturerDid,
      r.weekEnding,
      r.upcCode.padStart(12, '0'),
      r.quantity.toString().padStart(8, '0'),
      r.cartonCount.toString().padStart(6, '0'),
      r.netPurchases.toFixed(2).padStart(12, '0'),
      r.returns.toFixed(2).padStart(12, '0'),
    ].join('|'),
  )
  const trailer = `TRL|${records.length.toString().padStart(6, '0')}\n`
  return header + lines.join('\n') + '\n' + trailer
}
