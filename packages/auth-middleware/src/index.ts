import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common'
import type { Observable } from 'rxjs'
import { AuthGuard, PassportStrategy } from '@nestjs/passport'
import { Reflector } from '@nestjs/core'
import { Strategy, ExtractJwt } from 'passport-jwt'
import { AuthenticatedUser, JwtPayload, Role } from '@cosmos/types'
import { verifyServiceJwtToken } from './service-jwt'

export const ROLES_KEY = 'cosmos:roles'
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles)

export const PUBLIC_KEY = 'cosmos:public'
export const Public = () => SetMetadata(PUBLIC_KEY, true)

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest()
    return req.user as AuthenticatedUser
  },
)

export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest()
    const user = req.user as AuthenticatedUser | undefined
    if (!user?.tenantId) throw new UnauthorizedException('No tenant context')
    return user.tenantId
  },
)

@Injectable()
export class CosmosJwtStrategy extends PassportStrategy(Strategy, 'cosmos-jwt') {
  constructor(secret: string) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    })
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sub || !payload?.tenantId) {
      throw new UnauthorizedException('Invalid token payload')
    }
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId,
      permissions: [],
    }
  }
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('cosmos-jwt') {
  constructor(private reflector: Reflector) {
    super()
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true
    return super.canActivate(context)
  }
}

/**
 * JWT **or** gateway **service JWT** (`x-service-token` RS256) **or** legacy internal headers.
 * Service token path requires `x-cosmos-tenant-id` for tenant scoping.
 */
@Injectable()
export class InternalOrJwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtGuard: JwtAuthGuard,
  ) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const req = context.switchToHttp().getRequest()

    const rawPub = process.env.GATEWAY_SERVICE_JWT_PUBLIC_KEY?.trim() ?? ''
    const pubKey = rawPub.includes('BEGIN')
      ? rawPub.replace(/\\n/g, '\n')
      : rawPub
        ? Buffer.from(rawPub, 'base64').toString('utf-8')
        : ''
    const svcTokenRaw = req.headers['x-service-token'] as string | undefined
    const svcToken = svcTokenRaw?.trim()
    const serviceName = process.env.SERVICE_NAME?.trim() ?? ''

    if (svcToken) {
      if (!pubKey || !serviceName) {
        throw new UnauthorizedException('Service token not configured on this service')
      }
      const payload = verifyServiceJwtToken(svcToken, pubKey, serviceName)
      const tenantId = req.headers['x-cosmos-tenant-id'] as string | undefined
      if (!tenantId?.trim()) {
        throw new UnauthorizedException('x-cosmos-tenant-id required with service token')
      }
      req.callingService = payload.sub
      req.user = {
        userId: `svc:${payload.sub}`,
        email: 'gateway@cosmos.local',
        role: 'SUPER_ADMIN',
        tenantId: tenantId.trim(),
        permissions: ['gateway.service'],
      }
      return true
    }

    const secret = process.env.INTERNAL_SERVICE_SECRET
    const key = req.headers['x-cosmos-internal-key'] as string | undefined
    const tenantId = req.headers['x-cosmos-tenant-id'] as string | undefined

    if (secret && key === secret && tenantId && tenantId.length > 0) {
      req.user = {
        userId: 'internal-saga',
        email: 'internal@cosmos.local',
        role: 'SUPER_ADMIN',
        tenantId,
        permissions: ['internal.service'],
      }
      return true
    }

    return this.jwtGuard.canActivate(context) as Promise<boolean>
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (!required || required.length === 0) return true

    const user = ctx.switchToHttp().getRequest().user as AuthenticatedUser | undefined
    if (!user) throw new UnauthorizedException()
    if (user.role === 'SUPER_ADMIN') return true
    if (!required.includes(user.role)) {
      throw new ForbiddenException(`Role ${user.role} not in [${required.join(', ')}]`)
    }
    return true
  }
}

@Injectable()
export class TenantIsolationInterceptor {
  intercept(ctx: ExecutionContext, next: { handle: () => unknown }) {
    const req = ctx.switchToHttp().getRequest()
    const user = req.user as AuthenticatedUser | undefined
    if (user?.tenantId) {
      req.tenantId = user.tenantId
    }
    return next.handle()
  }
}

export * from './service-jwt'
export { ServiceJwtGuard } from './service-jwt.guard'
