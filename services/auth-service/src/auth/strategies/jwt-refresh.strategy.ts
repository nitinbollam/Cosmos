import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { Request } from 'express'
import { JwtPayload } from '@cosmos/types'

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_REFRESH_SECRET')
    if (!secret) throw new Error('JWT_REFRESH_SECRET not configured')
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      passReqToCallback: true,
    })
  }

  async validate(req: Request, payload: JwtPayload) {
    if (!payload?.sub) throw new UnauthorizedException('Invalid refresh token')
    const refreshToken = req.get('Authorization')?.replace('Bearer ', '').trim()
    if (!refreshToken) throw new UnauthorizedException('No refresh token')
    return { ...payload, refreshToken }
  }
}
