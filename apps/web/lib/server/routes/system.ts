import * as notifications from '../notifications'
import { getNotificationProviderStatus } from '../notification-provider-status'
import * as ledger from '../ledger'
import * as reportBuilder from '../report-builder'
import * as analytics from '../analytics'
import * as webhooks from '../webhooks'
import * as stripeConnect from '../stripe-connect'
import * as auditLog from '../audit-log'
import * as search from '../search'
import * as pos from '../pos'
import * as posReceipt from '../pos-receipt'
import * as featureFlags from '../feature-flags'
import * as celestial from '../celestial/orchestrator'
import { ApiError, requireSession, requireRole, requirePermission, assertPermission, hasPermission, ADMIN_ROLES, assertNotBuyer } from './common'

export async function routeNotifications(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  assertNotBuyer(session)
  const url = new URL(req.url)

  if (seg.length === 1 && method === 'GET') {
    assertPermission(session, 'notifications.read')
    const status = url.searchParams.get('status') ?? undefined
    const channel = url.searchParams.get('channel') ?? undefined
    const event = url.searchParams.get('event') ?? undefined
    const recipient = url.searchParams.get('recipient') ?? undefined
    return Response.json(
      await notifications.list(session.tenantId, { status, channel, event, recipient }),
    )
  }
  if (seg.length === 3 && seg[1] === 'providers' && seg[2] === 'status' && method === 'GET') {
    await requirePermission(req, 'notifications.read')
    return Response.json(getNotificationProviderStatus())
  }
  if (seg.length === 2 && seg[1] === 'retry' && method === 'POST') {
    const body = (await req.json()) as { id?: string }
    if (!body.id) throw new ApiError(400, 'id required')
    if (!hasPermission(session, 'notifications.write')) {
      const rows = await notifications.list(session.tenantId, { recipient: session.email })
      if (!rows.some((r) => r.id === body.id)) {
        throw new ApiError(403, 'You can only retry notifications sent to your email')
      }
    }
    return Response.json(await notifications.retry(session.tenantId, body.id))
  }
  if (seg.length === 2 && seg[1] === 'send' && method === 'POST') {
    assertPermission(session, 'notifications.write')
    const key = req.headers.get('idempotency-key')?.trim() || undefined
    const body = (await req.json()) as notifications.SendNotificationInput
    return Response.json(await notifications.send(session.tenantId, body, key))
  }
  throw new ApiError(404, 'Notification route not found')
}

export async function routeReports(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requirePermission(req, 'reports.read')
  const url = new URL(req.url)

  if (seg.length === 2 && seg[1] === 'trial-balance' && method === 'GET') {
    const y = url.searchParams.get('year')
    const m = url.searchParams.get('month')
    const q = url.searchParams.get('quarter')
    const pType = url.searchParams.get('periodType') as 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | null
    const year = y ? parseInt(y, 10) : new Date().getFullYear()
    const month = m ? parseInt(m, 10) : new Date().getMonth() + 1
    const quarter = q ? parseInt(q, 10) : 1
    return Response.json(
      await ledger.trialBalance(session.tenantId, year, {
        year,
        periodType: pType ?? 'MONTHLY',
        month,
        quarter,
      }),
    )
  }
  throw new ApiError(404, 'Report route not found')
}

export async function routeReportBuilder(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'reports.read' : 'reports.write')
  const url = new URL(req.url)

  if (seg.length === 2 && seg[1] === 'types' && method === 'GET') {
    return Response.json(reportBuilder.reportCatalog())
  }

  if (seg.length === 2 && seg[1] === 'run' && method === 'POST') {
    const body = (await req.json()) as { type?: string; filters?: unknown; format?: string }
    if (!reportBuilder.isReportType(body.type)) throw new ApiError(400, 'Invalid report type')
    const result = await reportBuilder.runReport(session.tenantId, body.type, body.filters)
    if (body.format === 'csv') {
      const stamp = new Date().toISOString().slice(0, 10)
      return reportBuilder.toCsvResponse(result, `${body.type.toLowerCase()}-${stamp}.csv`)
    }
    return Response.json(result)
  }

  if (seg.length === 2 && seg[1] === 'saved' && method === 'GET') {
    const mine = url.searchParams.get('mine') === '1'
    return Response.json(await reportBuilder.listSavedReports(session.tenantId, mine ? session.userId : undefined))
  }

  if (seg.length === 2 && seg[1] === 'saved' && method === 'POST') {
    const body = (await req.json()) as { name?: string; type?: string; filters?: unknown }
    if (!body.name?.trim()) throw new ApiError(400, 'name is required')
    if (!reportBuilder.isReportType(body.type)) throw new ApiError(400, 'Invalid report type')
    return Response.json(
      await reportBuilder.createSavedReport(session.tenantId, session.userId, {
        name: body.name,
        type: body.type,
        filters: body.filters,
      }),
      { status: 201 },
    )
  }

  if (seg.length === 3 && seg[1] === 'saved' && method === 'GET') {
    return Response.json(await reportBuilder.getSavedReport(session.tenantId, seg[2]))
  }

  if (seg.length === 3 && seg[1] === 'saved' && method === 'PATCH') {
    const body = (await req.json()) as { name?: string; filters?: unknown }
    return Response.json(await reportBuilder.updateSavedReport(session.tenantId, seg[2], body))
  }

  if (seg.length === 3 && seg[1] === 'saved' && method === 'DELETE') {
    return Response.json(await reportBuilder.deleteSavedReport(session.tenantId, seg[2]))
  }

  if (seg.length === 4 && seg[1] === 'saved' && seg[3] === 'run' && method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { format?: string }
    const result = await reportBuilder.runSavedReport(session.tenantId, seg[2])
    if (body.format === 'csv') {
      const saved = await reportBuilder.getSavedReport(session.tenantId, seg[2])
      const stamp = new Date().toISOString().slice(0, 10)
      const safe = saved.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48)
      return reportBuilder.toCsvResponse(result, `${safe || saved.type.toLowerCase()}-${stamp}.csv`)
    }
    return Response.json(result)
  }

  throw new ApiError(404, 'Report builder route not found')
}

export async function routeKpi(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  assertNotBuyer(session)
  assertPermission(session, 'reports.read')

  if (seg.length === 2 && seg[1] === 'snapshots' && method === 'GET') {
    return Response.json(await analytics.listSnapshots(session.tenantId))
  }
  throw new ApiError(404, 'KPI route not found')
}

export async function routeAnalytics(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  assertNotBuyer(session)
  assertPermission(session, 'reports.read')
  const url = new URL(req.url)

  if (seg.length === 2 && seg[1] === 'kpis' && method === 'GET') {
    return Response.json(await analytics.dashboardKpis(session.tenantId))
  }
  if (seg.length === 2 && seg[1] === 'cashflow-history' && method === 'GET') {
    const cashflowHistory = await import('../cashflow-history')
    const weeks = +(url.searchParams.get('weeks') ?? 16)
    return Response.json(await cashflowHistory.buildArApCashflowHistory(session.tenantId, weeks))
  }
  throw new ApiError(404, 'Analytics route not found')
}

export async function routeInternal(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requirePermission(req, 'reports.write')

  if (seg.length === 2 && seg[1] === 'refresh' && method === 'POST') {
    const body = (await req.json()) as analytics.RefreshKpiInput
    return Response.json(await analytics.upsertSnapshot(session.tenantId, session.role, body))
  }
  throw new ApiError(404, 'Internal route not found')
}

export async function routeWebhooks(method: string, seg: string[], req: Request): Promise<Response> {
  if (seg[1] === 'stripe' && seg[2] === 'connect' && method === 'POST') {
    const sig = req.headers.get('stripe-signature') ?? ''
    const raw = Buffer.from(await req.arrayBuffer())
    const result = stripeConnect.handleStripeConnectWebhook(raw, sig)
    return Response.json(result)
  }

  // Outbound webhook writes can exfiltrate data — keep admin-only protections.
  const session =
    method === 'GET' ? await requirePermission(req, 'settings.read') : await requireRole(req, ADMIN_ROLES)

  if (seg.length === 1 && method === 'GET') {
    return Response.json(await webhooks.listWebhooks(session.tenantId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as webhooks.CreateWebhookInput
    return Response.json(await webhooks.createWebhook(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'DELETE') {
    await webhooks.deleteWebhook(session.tenantId, seg[1])
    return new Response(null, { status: 204 })
  }
  if (seg.length === 3 && seg[2] === 'test' && method === 'POST') {
    return Response.json(await webhooks.testWebhook(session.tenantId, seg[1]))
  }
  throw new ApiError(404, 'Webhook route not found')
}

export async function routeAudit(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requirePermission(req, 'audit.read')
  const url = new URL(req.url)
  if (seg.length === 1 && method === 'GET') {
    return Response.json(
      await auditLog.listAuditEvents(session.tenantId, {
        entityType: url.searchParams.get('entityType') ?? undefined,
        entityId: url.searchParams.get('entityId') ?? undefined,
        limit: +(url.searchParams.get('limit') ?? 100),
      }),
    )
  }
  throw new ApiError(404, 'Audit route not found')
}

export async function routeSearch(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  assertNotBuyer(session)
  const q = new URL(req.url).searchParams.get('q') ?? ''
  if (seg.length === 1 && method === 'GET') {
    return Response.json(await search.globalSearch(session.tenantId, q))
  }
  throw new ApiError(404, 'Search route not found')
}

export async function routePos(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'pos.read' : 'pos.write')
  if (seg.length === 2 && seg[1] === 'registers' && method === 'GET') {
    return Response.json(await pos.listPosRegisters(session.tenantId))
  }
  if (seg.length === 2 && seg[1] === 'registers' && method === 'POST') {
    const body = (await req.json()) as { name: string; warehouseId?: string }
    return Response.json(await pos.createPosRegister(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && seg[1] === 'orders' && method === 'POST') {
    const body = (await req.json()) as Parameters<typeof pos.createPosOrder>[1]
    return Response.json(await pos.createPosOrder(session.tenantId, body, session.userId), { status: 201 })
  }
  if (seg.length === 4 && seg[1] === 'orders' && seg[3] === 'receipt' && method === 'GET') {
    const html = await posReceipt.buildPosReceiptHtml(session.tenantId, seg[2])
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  throw new ApiError(404, 'POS route not found')
}

export async function routeFeatures(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  assertPermission(session, 'settings.read')
  if (seg.length === 1 && method === 'GET') {
    return Response.json(await featureFlags.getTenantFeaturesDetail(session.tenantId))
  }
  throw new ApiError(404, 'Features route not found')
}

export async function routeCelestial(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requirePermission(req, 'celestial.chat')
  assertNotBuyer(session)

  if (seg.length === 2 && seg[1] === 'status' && method === 'GET') {
    const features = await featureFlags.getTenantFeatures(session.tenantId)
    return Response.json({
      ...celestial.getCelestialModelInfo(),
      enabled: Boolean(features.celestial),
    })
  }
  if (seg.length === 2 && seg[1] === 'chat' && method === 'POST') {
    const body = (await req.json()) as celestial.CelestialChatInput
    const accept = req.headers.get('accept') ?? ''
    const streamRequested =
      accept.includes('text/event-stream') ||
      accept.includes('application/x-ndjson') ||
      req.headers.get('x-celestial-stream') === '1'
    if (streamRequested) {
      return celestial.chatStream(session, body)
    }
    return Response.json(await celestial.chat(session, body))
  }
  if (seg.length === 3 && seg[1] === 'chat' && seg[2] === 'stream' && method === 'POST') {
    const body = (await req.json()) as celestial.CelestialChatInput
    return celestial.chatStream(session, body)
  }
  if (seg.length === 2 && seg[1] === 'conversations' && method === 'GET') {
    const url = new URL(req.url)
    const surface = url.searchParams.get('surface') as 'shop' | 'admin' | null
    const limit = Number(url.searchParams.get('limit') ?? '10')
    return Response.json(
      await celestial.listCelestialConversations(session, {
        surface: surface ?? undefined,
        limit: Number.isFinite(limit) ? limit : 10,
      }),
    )
  }
  if (seg.length === 3 && seg[1] === 'conversations' && method === 'GET') {
    return Response.json(await celestial.getCelestialConversation(session, seg[2]))
  }
  throw new ApiError(404, 'Celestial route not found')
}
