import { detectSeriesAnomalies, forecastCashFlow, type DetectRequest, type ForecastRequest } from '@cosmos/analytics-engine'
import { jwtVerify } from 'jose'
import { loginUser, logoutUser, refreshUserTokens, registerUser } from '../lib/server/auth'
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
      service: 'cosmos',
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
      return json(await loginUser(body.email.trim(), body.password))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Login failed'
      return json({ message: msg }, msg === 'Invalid credentials' ? 401 : 500)
    }
  }

  if (pathname === '/api/v1/auth/register' && req.method === 'POST') {
    let body: {
      tenantId?: string
      email?: string
      password?: string
      firstName?: string
      lastName?: string
      role?: string
    }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return json({ message: 'Invalid JSON body' }, 400)
    }
    if (!body.tenantId || !body.email || !body.password || !body.firstName || !body.lastName) {
      return json({ message: 'Missing required fields' }, 400)
    }
    try {
      return json(
        await registerUser({
          tenantId: body.tenantId,
          email: body.email.trim(),
          password: body.password,
          firstName: body.firstName,
          lastName: body.lastName,
          role: body.role,
        }),
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Registration failed'
      const status =
        msg === 'Tenant does not exist' || msg.includes('already registered')
          ? 409
          : msg === 'Invalid credentials'
            ? 401
            : 500
      return json({ message: msg }, status)
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
