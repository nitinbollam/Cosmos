import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

export const ROLES_KEY = 'roles'
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles)

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (!required?.length) return true
    const user = ctx.switchToHttp().getRequest().user
    if (!user) throw new ForbiddenException()
    if (user.role === 'SUPER_ADMIN') return true
    if (!required.includes(user.role)) {
      throw new ForbiddenException(`Role ${user.role} not allowed`)
    }
    return true
  }
}
