import { isPortalBuyer, getAuthProfile, requirePortalCustomerId } from '../buyer-context'
import * as crm from '../crm'
import * as pricing from '../pricing'
import * as customerNotificationPrefs from '../customer-notification-prefs'
import { ApiError, requireSession, requirePermission, assertPermission } from './common'

export async function routeCustomers(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)

  if (seg[1] === 'me' && seg.length === 2 && method === 'GET') {
    const profile = await getAuthProfile(session)
    if (!profile.customerId) throw new ApiError(404, 'No customer linked to this account')
    return Response.json(await crm.getCustomer(session.tenantId, profile.customerId))
  }

  if (seg[1] === 'me' && seg[2] === 'notification-prefs' && seg.length === 3 && method === 'GET') {
    if (!isPortalBuyer(session.role)) throw new ApiError(403, 'Forbidden')
    const customerId = await requirePortalCustomerId(session)
    return Response.json(await customerNotificationPrefs.getCustomerNotificationPrefs(session.tenantId, customerId))
  }

  if (seg[1] === 'me' && seg[2] === 'notification-prefs' && seg.length === 3 && method === 'PATCH') {
    if (!isPortalBuyer(session.role)) throw new ApiError(403, 'Forbidden')
    const customerId = await requirePortalCustomerId(session)
    const body = (await req.json()) as Partial<customerNotificationPrefs.CustomerNotificationPrefs>
    return Response.json(
      await customerNotificationPrefs.patchCustomerNotificationPrefs(session.tenantId, customerId, body),
    )
  }

  if (seg[1] === 'me' && seg[2] === 'prices' && seg.length === 3 && method === 'GET') {
    const profile = await getAuthProfile(session)
    if (!profile.customerId) throw new ApiError(404, 'No customer linked to this account')
    return Response.json(await pricing.listCustomerPrices(session.tenantId, profile.customerId))
  }

  if (seg[1] === 'me' && seg.length === 2 && method === 'PATCH') {
    if (!isPortalBuyer(session.role)) throw new ApiError(403, 'Forbidden')
    const profile = await getAuthProfile(session)
    if (!profile.customerId) throw new ApiError(404, 'No customer linked to this account')
    const body = (await req.json()) as Parameters<typeof crm.patchCustomerProfile>[2]
    return Response.json(await crm.patchCustomerProfile(session.tenantId, profile.customerId, body))
  }

  if (isPortalBuyer(session.role)) {
    throw new ApiError(403, 'Forbidden')
  }
  assertPermission(session, method === 'GET' ? 'crm.read' : 'crm.write')

  if (seg[1] === 'lookup' && method === 'GET') {
    const ref = new URL(req.url).searchParams.get('externalRef')
    if (!ref) throw new ApiError(400, 'externalRef query required')
    const row = await crm.findCustomerByExternalRef(session.tenantId, ref)
    if (!row) throw new ApiError(404, 'Customer not found')
    return Response.json(row)
  }
  if (seg[1] === 'import' && method === 'POST') {
    const body = (await req.json()) as { rows?: Record<string, unknown>[] }
    return Response.json(await crm.importCustomers(session.tenantId, body.rows ?? []))
  }
  if (seg.length === 1 && method === 'GET') {
    const url = new URL(req.url)
    const pageParam = url.searchParams.get('page')
    if (pageParam) {
      return Response.json(
        await crm.listCustomersPaged(session.tenantId, {
          page: +pageParam || 1,
          pageSize: +(url.searchParams.get('pageSize') ?? 25) || 25,
          search: url.searchParams.get('search') ?? undefined,
        }),
      )
    }
    return Response.json(await crm.listCustomers(session.tenantId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(await crm.createCustomer(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await crm.getCustomer(session.tenantId, seg[1]))
  }
  if (seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(await crm.patchCustomer(session.tenantId, seg[1], body))
  }
  if (seg.length === 3 && seg[2] === 'prices' && method === 'GET') {
    return Response.json(await pricing.listCustomerPrices(session.tenantId, seg[1]))
  }
  if (seg.length === 3 && seg[2] === 'prices' && method === 'POST') {
    assertPermission(session, 'crm.write')
    const body = (await req.json()) as pricing.UpsertCustomerPriceInput
    return Response.json(await pricing.upsertCustomerPrice(session.tenantId, seg[1], body), { status: 201 })
  }
  if (seg.length === 4 && seg[2] === 'prices' && method === 'DELETE') {
    assertPermission(session, 'crm.write')
    return Response.json(await pricing.deleteCustomerPrice(session.tenantId, seg[1], seg[3]))
  }
  throw new ApiError(404, 'Customer route not found')
}

export async function routeLeads(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'crm.read' : 'crm.write')

  if (seg[1] === 'import' && method === 'POST') {
    const body = (await req.json()) as { rows?: Record<string, unknown>[] }
    return Response.json(await crm.importLeads(session.tenantId, body.rows ?? []))
  }
  if (seg.length === 1 && method === 'GET') {
    return Response.json(await crm.listLeads(session.tenantId))
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(await crm.createLead(session.tenantId, body), { status: 201 })
  }
  if (seg.length === 2 && method === 'GET') {
    return Response.json(await crm.getLead(session.tenantId, seg[1]))
  }
  if (seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(await crm.patchLead(session.tenantId, seg[1], body))
  }
  if (seg.length === 3 && seg[2] === 'convert' && method === 'POST') {
    const body = (await req.json()) as { customerName?: string }
    if (!body.customerName) throw new ApiError(400, 'customerName required')
    return Response.json(await crm.convertLead(session.tenantId, seg[1], body.customerName))
  }
  throw new ApiError(404, 'Lead route not found')
}

export async function routeActivities(method: string, seg: string[], req: Request): Promise<Response> {
  const isRead = method === 'GET'
  const session = await requirePermission(req, isRead ? 'crm.read' : 'crm.write')
  const url = new URL(req.url)

  if (seg.length === 1 && method === 'GET') {
    return Response.json(
      await crm.listActivities(
        session.tenantId,
        url.searchParams.get('customerId') ?? undefined,
        url.searchParams.get('leadId') ?? undefined,
      ),
    )
  }
  if (seg.length === 1 && method === 'POST') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(await crm.createActivity(session.tenantId, body), { status: 201 })
  }
  throw new ApiError(404, 'Activity route not found')
}
