import * as tenant from '../tenant'
import * as users from '../users'
import { ApiError, requireSession, requirePermission, assertPermission, assertNotBuyer } from './common'

export async function routeTenants(method: string, seg: string[], req: Request): Promise<Response> {
  const session = await requireSession(req)
  const tenantId = session.tenantId
  assertNotBuyer(session)
  // Tenant settings, invites, plan, and onboarding are admin-only beyond reads.
  if (method !== 'GET' || seg[2] === 'invites') {
    assertPermission(session, seg[2] === 'invites' ? ['users.read', 'users.write', 'settings.write'] : 'settings.write')
  } else {
    assertPermission(session, 'settings.read')
  }

  if (seg[1] === 'me' && seg.length === 2 && method === 'GET') {
    return Response.json(await tenant.findTenantById(tenantId))
  }
  if (seg[1] === 'me' && seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as Record<string, unknown>
    return Response.json(await tenant.patchTenant(tenantId, body as Parameters<typeof tenant.patchTenant>[1]))
  }
  if (seg[1] === 'me' && seg[2] === 'invites' && seg.length === 3) {
    if (method === 'GET') return Response.json(await tenant.listPendingInvites(tenantId))
    if (method === 'POST') {
      const body = (await req.json()) as { email?: string; role?: string }
      if (!body.email) throw new ApiError(400, 'email required')
      return Response.json(await tenant.createInvite(tenantId, { email: body.email, role: body.role }))
    }
  }
  if (seg[1] === 'me' && seg[2] === 'invites' && seg.length === 4 && method === 'DELETE') {
    await tenant.revokeInvite(tenantId, seg[3])
    return Response.json({ ok: true })
  }
  if (seg[1] === 'me' && seg[2] === 'upgrade' && method === 'POST') {
    const body = (await req.json()) as { plan?: 'STARTER' | 'GROWTH' | 'ENTERPRISE' }
    if (!body.plan) throw new ApiError(400, 'plan required')
    return Response.json(await tenant.updateTenantPlan(tenantId, body.plan))
  }
  if (seg[1] === 'me' && seg[2] === 'plan' && method === 'PATCH') {
    const body = (await req.json()) as { plan?: 'STARTER' | 'GROWTH' | 'ENTERPRISE' }
    if (!body.plan) throw new ApiError(400, 'plan required')
    return Response.json(await tenant.updateTenantPlan(tenantId, body.plan))
  }
  if (seg[1] === 'me' && seg[2] === 'billing' && seg.length === 3 && method === 'GET') {
    const billing = await import('../billing')
    return Response.json(await billing.getBillingStatus(tenantId))
  }
  if (seg[1] === 'me' && seg[2] === 'billing' && seg[3] === 'checkout' && method === 'POST') {
    const billing = await import('../billing')
    const body = (await req.json()) as { plan?: 'GROWTH' | 'ENTERPRISE' }
    if (!body.plan) throw new ApiError(400, 'plan must be GROWTH or ENTERPRISE')
    const org = await tenant.findTenantById(tenantId)
    const email = org.billingEmail ?? session.email
    if (!email) throw new ApiError(400, 'Set a billing email on your company profile first')
    return Response.json(await billing.createCheckoutSession(tenantId, body.plan, email))
  }
  if (seg[1] === 'me' && seg[2] === 'billing' && seg[3] === 'portal' && method === 'POST') {
    const billing = await import('../billing')
    const org = await tenant.findTenantById(tenantId)
    const email = org.billingEmail ?? session.email
    if (!email) throw new ApiError(400, 'Set a billing email on your company profile first')
    return Response.json(await billing.createPortalSession(tenantId, email))
  }
  if (seg[1] === 'me' && seg[2] === 'onboarding-steps' && seg.length === 4 && method === 'PATCH') {
    const body = (await req.json()) as { completed?: boolean; payload?: Record<string, unknown> }
    return Response.json(await tenant.patchOnboardingStep(tenantId, seg[3], body))
  }
  if (seg[1] === 'me' && seg[2] === 'workflow-settings' && seg.length === 3 && method === 'GET') {
    const { getTenantEngagementSettings } = await import('../tenant-engagement-settings')
    return Response.json(await getTenantEngagementSettings(tenantId))
  }
  if (seg[1] === 'me' && seg[2] === 'workflow-settings' && seg.length === 3 && method === 'PATCH') {
    const { updateTenantEngagementSettings } = await import('../tenant-engagement-settings')
    const body = (await req.json()) as {
      poApprovalThreshold?: number
      discountApprovalThresholdPct?: number
      loyaltyPointsPerDollar?: number
      loyaltyPointsToDollarRate?: number
    }
    return Response.json(await updateTenantEngagementSettings(tenantId, body))
  }
  if (seg[1] === 'me' && seg[2] === 'finance-settings' && seg.length === 3 && method === 'GET') {
    const { getTenantFinanceSettings } = await import('../tenant-finance-settings')
    return Response.json(await getTenantFinanceSettings(tenantId))
  }
  if (seg[1] === 'me' && seg[2] === 'finance-settings' && seg.length === 3 && method === 'PATCH') {
    const { updateTenantFinanceSettings } = await import('../tenant-finance-settings')
    const body = (await req.json()) as {
      baseCurrency?: string
      expenseApprovalThreshold?: number
    }
    return Response.json(await updateTenantFinanceSettings(tenantId, body))
  }
  throw new ApiError(404, 'Tenant route not found')
}

export async function routeUsers(method: string, seg: string[], req: Request): Promise<Response> {
  const session =
    method === 'GET'
      ? await requirePermission(req, 'users.read')
      : await requirePermission(req, 'users.write')
  const url = new URL(req.url)

  if (seg.length === 1 && method === 'GET') {
    const page = +(url.searchParams.get('page') ?? 1)
    const pageSize = +(url.searchParams.get('pageSize') ?? 20)
    return Response.json(await users.listUsers(session.tenantId, page, pageSize))
  }
  if (seg.length === 2 && method === 'PATCH') {
    const body = (await req.json()) as { role?: string; isActive?: boolean; permissions?: string[] }
    return Response.json(await users.updateUser(session.tenantId, seg[1], body, session.userId))
  }
  if (seg.length === 2 && method === 'DELETE') {
    if (seg[1] === session.userId) throw new ApiError(400, 'You cannot deactivate your own account')
    return Response.json(await users.deactivateUser(session.tenantId, seg[1]))
  }
  throw new ApiError(404, 'User route not found')
}
