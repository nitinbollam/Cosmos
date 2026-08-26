import * as complianceMsa from '../compliance-msa'
import type { InitiateRecallInput } from '../compliance-recall'
import { isPortalBuyer, requirePortalCustomerId } from '../buyer-context'
import { ApiError, requireSession, requirePermission, assertPermission, assertNotBuyer } from './common'

export async function routeMsa(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  assertNotBuyer(session)
  assertPermission(session, method === 'GET' ? 'compliance.read' : 'compliance.write')
  const url = new URL(req.url)

  if (seg.length === 2 && seg[1] === 'reports' && method === 'GET') {
    return Response.json(
      await complianceMsa.listReports(session.tenantId, url.searchParams.get('status') ?? undefined),
    )
  }
  if (seg.length === 3 && seg[1] === 'reports' && method === 'GET') {
    return Response.json(await complianceMsa.getReport(session.tenantId, seg[2]))
  }
  if (seg.length === 3 && seg[1] === 'reports' && seg[2] === 'generate' && method === 'POST') {
    const offset = url.searchParams.get('weekOffset')
    const weekOffset = offset ? parseInt(offset, 10) : 0
    const ids = await complianceMsa.generateReportForTenant(session.tenantId, weekOffset)
    return Response.json({ reports: ids })
  }
  if (seg.length === 2 && seg[1] === 'run-now' && method === 'POST') {
    const offset = url.searchParams.get('weekOffset')
    const weekOffset = offset ? parseInt(offset, 10) : 0
    const result = await complianceMsa.runMsaAutomationCron(session.tenantId, weekOffset)
    return Response.json(result)
  }
  if (seg.length === 2 && seg[1] === 'cron' && method === 'POST') {
    await requirePermission(req, 'compliance.write')
    const offset = url.searchParams.get('weekOffset')
    const weekOffset = offset ? parseInt(offset, 10) : 0
    return Response.json(await complianceMsa.runMsaAutomationCron(session.tenantId, weekOffset))
  }
  if (seg.length === 4 && seg[1] === 'reports' && seg[3] === 'upload' && method === 'POST') {
    await requirePermission(req, 'compliance.write')
    return Response.json(await complianceMsa.uploadReportToStorage(session.tenantId, seg[2]))
  }
  if (seg.length === 4 && seg[1] === 'reports' && seg[3] === 'submit' && method === 'POST') {
    await requirePermission(req, 'compliance.write')
    return Response.json(await complianceMsa.submitReportEdi(session.tenantId, seg[2]))
  }
  if (seg.length === 3 && seg[1] === 'transactions' && seg[2] === 'import' && method === 'POST') {
    const body = (await req.json()) as { rows?: complianceMsa.MsaTransactionImportRow[] }
    return Response.json(await complianceMsa.importTransactions(session.tenantId, body.rows ?? []))
  }
  if (seg.length === 2 && seg[1] === 'config' && method === 'GET') {
    return Response.json(await complianceMsa.getConfig(session.tenantId))
  }
  if (seg.length === 2 && seg[1] === 'config' && method === 'POST') {
    const body = (await req.json()) as complianceMsa.UpsertMsaConfigInput
    return Response.json(await complianceMsa.upsertConfig(session.tenantId, body))
  }
  throw new ApiError(404, 'MSA route not found')
}

export async function routeCompliance(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const age = await import('../compliance-age')

  if (seg.length === 2 && seg[1] === 'age-verification' && method === 'GET') {
    assertPermission(session, 'compliance.read')
    return Response.json(await age.getAgeVerificationPolicy(session.tenantId))
  }
  if (seg.length === 2 && seg[1] === 'age-verification' && method === 'PATCH') {
    assertNotBuyer(session)
    assertPermission(session, 'compliance.write')
    const body = (await req.json()) as Partial<{
      enabled: boolean
      minimumAge: number
      requireTobaccoLicense: boolean
      requirePosAttestation: boolean
      requireDeliveryConfirmation: boolean
    }>
    return Response.json(await age.updateAgeVerificationPolicy(session.tenantId, body))
  }
  if (seg.length === 2 && seg[1] === 'age-check' && method === 'POST') {
    const body = (await req.json()) as {
      customerId?: string
      channel?: string
      lineItems?: Array<{ skuId: string }>
    }
    if (!body.customerId || !Array.isArray(body.lineItems)) {
      throw new ApiError(400, 'customerId and lineItems are required')
    }
    if (isPortalBuyer(session.role)) {
      const buyerCustomerId = await requirePortalCustomerId(session)
      if (body.customerId !== buyerCustomerId) throw new ApiError(403, 'Cannot check another customer')
    } else {
      assertNotBuyer(session)
    }
    return Response.json(
      await age.previewOrderAgeRequirements(
        session.tenantId,
        body.customerId,
        body.lineItems,
        body.channel ?? 'B2B_PORTAL',
      ),
    )
  }

  const recall = await import('../compliance-recall')
  const url = new URL(req.url)

  if (seg.length === 2 && seg[1] === 'batches' && method === 'GET') {
    assertNotBuyer(session)
    assertPermission(session, 'compliance.read')
    return Response.json(await recall.listTenantBatches(session.tenantId))
  }
  if (seg.length === 2 && seg[1] === 'recalls' && method === 'GET') {
    assertNotBuyer(session)
    assertPermission(session, 'compliance.read')
    const st = url.searchParams.get('status') ?? undefined
    return Response.json(await recall.listBatchRecalls(session.tenantId, st))
  }
  if (seg.length === 2 && seg[1] === 'recalls' && method === 'POST') {
    assertNotBuyer(session)
    assertPermission(session, 'compliance.write')
    const body = (await req.json()) as InitiateRecallInput
    return Response.json(await recall.initiateBatchRecall(session.tenantId, body))
  }
  if (seg.length === 3 && seg[1] === 'recalls' && method === 'GET') {
    assertNotBuyer(session)
    assertPermission(session, 'compliance.read')
    return Response.json(await recall.getBatchRecallImpactReport(session.tenantId, seg[2]))
  }
  if (seg.length === 4 && seg[1] === 'recalls' && seg[3] === 'impact-report' && method === 'GET') {
    assertNotBuyer(session)
    assertPermission(session, 'compliance.read')
    return Response.json(await recall.getBatchRecallImpactReport(session.tenantId, seg[2]))
  }
  if (seg.length === 4 && seg[1] === 'recalls' && seg[3] === 'resolve' && method === 'POST') {
    assertNotBuyer(session)
    assertPermission(session, 'compliance.write')
    return Response.json(await recall.resolveBatchRecall(session.tenantId, seg[2]))
  }

  throw new ApiError(404, 'Compliance route not found')
}
