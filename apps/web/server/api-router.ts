import { detectSeriesAnomalies, forecastCashFlow, type DetectRequest, type ForecastRequest } from '@pleros/analytics-engine'
import { jwtVerify } from 'jose'
import {
  acceptInvite,
  changePassword,
  loginUser,
  logoutUser,
  refreshUserTokens,
  requestPasswordReset,
  resendEmailVerification,
  resetPassword,
  verifyEmail,
} from '../lib/server/auth'
import { assertPasswordPolicy, clientIp, rateLimit } from '../lib/server/auth-security'
import { publicSignup } from '../lib/server/signup'
import { getAuthProfile } from '../lib/server/buyer-context'
import { jwtSecret } from '../lib/server/env'
import { handleNativeApi } from '../lib/server/native-router'
import { ApiError, requireSession, toJsonError } from '../lib/server/session'

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

export async function handleApiRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const pathname = url.pathname

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  if (pathname === '/api/v1/health' && req.method === 'GET') {
    return json({
      status: 'ok',
      service: 'pleros',
      api: 'native',
      timestamp: new Date().toISOString(),
    })
  }

  if (pathname === '/api/anomaly' && req.method === 'POST') {
    let body: DetectRequest
    try {
      body = (await req.json()) as DetectRequest
    } catch {
      return json({ message: 'Invalid JSON body' }, 400)
    }
    try {
      return json(detectSeriesAnomalies(body))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'anomaly detection failed'
      return json({ message: msg }, msg.includes('must contain') ? 400 : 500)
    }
  }

  if (pathname === '/api/cashflow' && req.method === 'POST') {
    let body: ForecastRequest
    try {
      body = (await req.json()) as ForecastRequest
    } catch {
      return json({ message: 'Invalid JSON body' }, 400)
    }
    try {
      return json(forecastCashFlow(body))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'cashflow forecast failed'
      return json({ message: msg }, msg.includes('must contain') || msg.includes('between') ? 400 : 500)
    }
  }

  if (pathname === '/api/v1/auth/login' && req.method === 'POST') {
    let body: { email?: string; password?: string }
    try {
      body = (await req.json()) as { email?: string; password?: string }
    } catch {
      return json({ message: 'Invalid JSON body' }, 400)
    }
    if (!body.email?.trim() || !body.password) {
      return json({ message: 'email and password required' }, 400)
    }
    try {
      rateLimit(`login:${clientIp(req)}`, 20, 5 * 60 * 1000)
      rateLimit(`login:${body.email.trim().toLowerCase()}`, 10, 5 * 60 * 1000)
      return json(await loginUser(body.email.trim(), body.password))
    } catch (e) {
      if (e instanceof ApiError) return toJsonError(e)
      const msg = e instanceof Error ? e.message : 'Login failed'
      return json({ message: msg }, msg === 'Invalid credentials' ? 401 : 500)
    }
  }

  if (pathname === '/api/v1/auth/signup' && req.method === 'POST') {
    let body: {
      companyName?: string
      slug?: string
      email?: string
      password?: string
      firstName?: string
      lastName?: string
    }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return json({ message: 'Invalid JSON body' }, 400)
    }
    if (!body.companyName || !body.slug || !body.email || !body.password || !body.firstName || !body.lastName) {
      return json({ message: 'Missing required fields' }, 400)
    }
    try {
      rateLimit(`signup:${clientIp(req)}`, 5, 60 * 60 * 1000)
      assertPasswordPolicy(body.password)
      return json(
        await publicSignup({
          companyName: body.companyName,
          slug: body.slug,
          email: body.email,
          password: body.password,
          firstName: body.firstName,
          lastName: body.lastName,
        }),
        201,
      )
    } catch (e) {
      return toJsonError(e)
    }
  }

  // The old open /auth/register (arbitrary tenantId + role) was a tenant-takeover
  // vector. Joining an existing tenant now requires an admin-issued invite token.
  if (pathname === '/api/v1/auth/accept-invite' && req.method === 'POST') {
    let body: { token?: string; password?: string; firstName?: string; lastName?: string }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return json({ message: 'Invalid JSON body' }, 400)
    }
    if (!body.token || !body.password || !body.firstName?.trim() || !body.lastName?.trim()) {
      return json({ message: 'token, password, firstName, and lastName are required' }, 400)
    }
    try {
      rateLimit(`accept-invite:${clientIp(req)}`, 10, 60 * 60 * 1000)
      return json(
        await acceptInvite({
          token: body.token,
          password: body.password,
          firstName: body.firstName,
          lastName: body.lastName,
        }),
        201,
      )
    } catch (e) {
      if (e instanceof ApiError) return toJsonError(e)
      const msg = e instanceof Error ? e.message : 'Failed to accept invite'
      return json({ message: msg }, msg.includes('already registered') ? 409 : 500)
    }
  }

  if (pathname === '/api/v1/auth/forgot-password' && req.method === 'POST') {
    let body: { email?: string }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return json({ message: 'Invalid JSON body' }, 400)
    }
    if (!body.email?.trim()) return json({ message: 'email required' }, 400)
    try {
      rateLimit(`forgot:${clientIp(req)}`, 5, 15 * 60 * 1000)
      await requestPasswordReset(body.email)
      // Always succeed so the endpoint can't be used to enumerate accounts.
      return json({ ok: true })
    } catch (e) {
      return toJsonError(e)
    }
  }

  if (pathname === '/api/v1/auth/reset-password' && req.method === 'POST') {
    let body: { token?: string; password?: string }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return json({ message: 'Invalid JSON body' }, 400)
    }
    if (!body.token || !body.password) return json({ message: 'token and password required' }, 400)
    try {
      rateLimit(`reset:${clientIp(req)}`, 10, 15 * 60 * 1000)
      await resetPassword(body.token, body.password)
      return json({ ok: true })
    } catch (e) {
      return toJsonError(e)
    }
  }

  if (pathname === '/api/v1/auth/change-password' && req.method === 'POST') {
    try {
      const session = await requireSession(req)
      const body = (await req.json()) as { currentPassword?: string; newPassword?: string }
      if (!body.currentPassword || !body.newPassword) {
        return json({ message: 'currentPassword and newPassword required' }, 400)
      }
      rateLimit(`change-password:${session.userId}`, 5, 15 * 60 * 1000)
      await changePassword(session.userId, body.currentPassword, body.newPassword)
      return json({ ok: true })
    } catch (e) {
      return toJsonError(e)
    }
  }

  if (pathname === '/api/v1/auth/verify-email' && req.method === 'POST') {
    let body: { token?: string }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return json({ message: 'Invalid JSON body' }, 400)
    }
    if (!body.token) return json({ message: 'token required' }, 400)
    try {
      await verifyEmail(body.token)
      return json({ ok: true })
    } catch (e) {
      return toJsonError(e)
    }
  }

  if (pathname === '/api/v1/auth/resend-verification' && req.method === 'POST') {
    let body: { email?: string }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return json({ message: 'Invalid JSON body' }, 400)
    }
    if (!body.email?.trim()) return json({ message: 'email required' }, 400)
    try {
      rateLimit(`resend-verify:${clientIp(req)}`, 5, 15 * 60 * 1000)
      return json(await resendEmailVerification(body.email))
    } catch (e) {
      return toJsonError(e)
    }
  }

  if (pathname === '/api/v1/auth/refresh' && req.method === 'POST') {
    let body: { userId?: string; refreshToken?: string }
    try {
      body = (await req.json()) as { userId?: string; refreshToken?: string }
    } catch {
      return json({ message: 'Invalid JSON body' }, 400)
    }
    if (!body.userId || !body.refreshToken) {
      return json({ message: 'userId and refreshToken required' }, 400)
    }
    try {
      return json(await refreshUserTokens(body.userId, body.refreshToken))
    } catch {
      return json({ message: 'Access denied' }, 403)
    }
  }

  if (pathname === '/api/v1/auth/me' && req.method === 'GET') {
    try {
      const session = await requireSession(req)
      return json(await getAuthProfile(session))
    } catch (e) {
      return toJsonError(e)
    }
  }

  if (pathname === '/api/v1/auth/logout' && req.method === 'POST') {
    const auth = req.headers.get('authorization')
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return json({ message: 'Unauthorized' }, 401)
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret()))
      const sub = payload.sub
      if (typeof sub === 'string') await logoutUser(sub)
      return json({ ok: true })
    } catch {
      return json({ message: 'Unauthorized' }, 401)
    }
  }

  if (pathname.startsWith('/api/v1/')) {
    const segments = pathname.slice('/api/v1/'.length).split('/').filter(Boolean)
    if (segments[0] === 'auth') {
      return json({ message: 'Auth route not found' }, 404)
    }
    try {
      const native = await handleNativeApi(req.method, segments, req)
      if (native) return native
      throw new ApiError(404, `API route not found: /${segments.join('/')}`)
    } catch (e) {
      return toJsonError(e)
    }
  }

  return json({ message: 'Not found' }, 404)
}
