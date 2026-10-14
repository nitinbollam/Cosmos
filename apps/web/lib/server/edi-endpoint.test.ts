import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { Prisma } from '@/generated/prisma-compliance'
import { submitReportEdi, upsertConfig } from './compliance-msa'
import { complianceDb } from './db'
import { persistMsaFile } from './msa-storage'
import type { ResolveHost } from './safe-outbound'

const tenantId = `t-${randomUUID()}`
const manufacturerDid = `MFR${randomUUID().slice(0, 8)}`
const PUBLIC = { address: '93.184.216.34', family: 4 }
const always =
  (...addresses: Array<{ address: string; family: number }>): ResolveHost =>
  async () =>
    addresses

let reportId = ''

before(async () => {
  const filePath = `test/${tenantId}/report.txt`
  await persistMsaFile(filePath, 'HDR|TEST|20260101|MULTICAT|1.0\n')
  const report = await complianceDb.mSAReport.create({
    data: {
      tenantId,
      reporterDid: 'REP1',
      manufacturerDid,
      weekStart: new Date('2026-01-04'),
      weekEnding: new Date('2026-01-10'),
      filePath,
      fileHash: 'x',
      totalTransactions: 1,
      netPurchases: new Prisma.Decimal(10),
      status: 'GENERATED',
    },
  })
  reportId = report.id
})

after(async () => {
  await complianceDb.mSAReport.deleteMany({ where: { tenantId } })
  await complianceDb.mSAManufacturerDid.deleteMany({ where: { msaTenant: { tenantId } } })
  await complianceDb.mSATenant.deleteMany({ where: { tenantId } })
})

const config = (ediEndpoint: string) => ({
  reporterDid: 'REP1',
  manufacturerDid,
  manufacturerName: 'Test Manufacturer',
  ediEndpoint,
})

/** Store an endpoint directly, as one saved before endpoints were checked would be. */
async function storeEndpoint(ediEndpoint: string) {
  await upsertConfig(tenantId, config('https://edi.example/submit'), always(PUBLIC))
  await complianceDb.mSAManufacturerDid.updateMany({
    where: { manufacturerDid, msaTenant: { tenantId } },
    data: { ediEndpoint },
  })
}

/** A local listener that records whether anything ever connected to it. */
async function tripwire() {
  let connections = 0
  const server = createServer((socket) => {
    connections++
    socket.destroy()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => connections,
    close: () => new Promise((r) => server.close(r)),
  }
}

test('an EDI endpoint must be a public https URL', async () => {
  for (const raw of [
    'http://edi.example/submit',
    'https://169.254.169.254/latest/meta-data/',
    'https://100.64.0.1/submit',
    'https://localhost/submit',
  ]) {
    await assert.rejects(upsertConfig(tenantId, config(raw), always(PUBLIC)), { status: 400 }, raw)
  }
  await assert.rejects(
    upsertConfig(tenantId, config('https://edi.example/submit'), always({ address: '10.0.0.8', family: 4 })),
    { status: 400 },
  )
  const saved = await upsertConfig(tenantId, config('https://edi.example/submit'), always(PUBLIC))
  assert.equal(saved?.manufacturerDids[0]?.ediEndpoint, 'https://edi.example/submit')
})

test('an internal endpoint saved before the check is refused at send time and never contacted', async () => {
  const wire = await tripwire()
  try {
    await storeEndpoint(`https://127.0.0.1:${wire.port}/submit`)
    await assert.rejects(submitReportEdi(tenantId, reportId, always(PUBLIC)), { status: 502 })
    assert.equal(wire.connections(), 0)
    const report = await complianceDb.mSAReport.findUniqueOrThrow({ where: { id: reportId } })
    assert.equal(report.status, 'SUBMISSION_FAILED')
    assert.match(String(report.submissionError), /private IP/)
  } finally {
    await wire.close()
  }
})

test('an endpoint whose host switches to an internal address at send time is never contacted', async () => {
  const wire = await tripwire()
  try {
    await storeEndpoint(`https://edi.example:${wire.port}/submit`)
    let lookups = 0
    const rebinding: ResolveHost = async () =>
      ++lookups === 1 ? [PUBLIC] : [{ address: '127.0.0.1', family: 4 }]
    await assert.rejects(submitReportEdi(tenantId, reportId, rebinding), { status: 502 })
    assert.equal(wire.connections(), 0)
  } finally {
    await wire.close()
  }
})
