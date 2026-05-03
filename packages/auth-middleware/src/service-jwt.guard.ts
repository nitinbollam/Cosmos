import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as jwt from 'jsonwebtoken'
import type { AuthenticatedUser } from '@cosmos/types'

/**
 * Service-only auth: RS256 **`x-service-token`** (gateway-minted) **or** legacy internal headers.
 * Use on routes that must not accept end-user JWTs alone when stricter isolation is required.
 */
@Injectable()
export class ServiceJwtGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest()
    const token = req.headers['x-service-token'] as string | undefined

    if (!token?.trim()) {
      const secret = this.config.get<string>('INTERNAL_SERVICE_SECRET')
      const provided = req.headers['x-cosmos-internal-key'] as string | undefined
      const tenantId = req.headers['x-cosmos-tenant-id'] as string | undefined
      if (secret && provided === secret && tenantId?.trim()) {
        req.user = {
          userId: 'internal-service',
          email: 'internal@cosmos.local',
          role: 'SUPER_ADMIN',
          tenantId: tenantId.trim(),
          permissions: ['internal.service'],
        } as AuthenticatedUser
        return true
      }
      throw new UnauthorizedException('Missing service authentication')
    }

    const rawKey = this.config.get<string>('GATEWAY_SERVICE_JWT_PUBLIC_KEY')?.trim()
    if (!rawKey) throw new UnauthorizedException('Public key not configured')

    const publicKey = rawKey.includes('BEGIN')
      ? rawKey.replace(/\\n/g, '\n')
      : Buffer.from(rawKey, 'base64').toString('utf-8')
    const serviceName = this.config.get<string>('SERVICE_NAME')?.trim() ?? ''

    try {
      const decoded = jwt.verify(token.trim(), publicKey, {
        algorithms: ['RS256'],
        issuer: 'cosmos-gateway',
      }) as jwt.JwtPayload

      const rawAud = decoded.aud
      const aud = Array.isArray(rawAud) ? rawAud[0] : rawAud
      if (!serviceName || aud !== serviceName) {
        throw new UnauthorizedException('Token audience mismatch for this service')
      }
      if (decoded.iss !== 'cosmos-gateway') throw new Error('Wrong issuer')

      req.callingService = typeof decoded.sub === 'string' ? decoded.sub : 'gateway-service'

      const tenantId = req.headers['x-cosmos-tenant-id'] as string | undefined
      if (tenantId?.trim()) {
        req.user = {
          userId: `svc:${req.callingService}`,
          email: 'gateway@cosmos.local',
          role: 'SUPER_ADMIN',
          tenantId: tenantId.trim(),
          permissions: ['gateway.service'],
        } as AuthenticatedUser
      }

      return true
    } catch {
      throw new UnauthorizedException('Invalid or expired service token')
    }
  }
}
