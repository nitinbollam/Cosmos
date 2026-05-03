import * as jwt from 'jsonwebtoken'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { randomUUID } from 'crypto'

export interface ServiceJwtPayload {
  sub: string
  iss: string
  aud: string
  iat?: number
  exp?: number
}

/** Verify RS256 service token minted by gateway (`iss` = cosmos-gateway, `aud` = target service name). */
export function verifyServiceJwtToken(
  token: string,
  publicKeyPem: string,
  expectedAudience: string,
): ServiceJwtPayload {
  try {
    const decoded = jwt.verify(token.replace(/^Bearer\s+/i, ''), publicKeyPem, {
      algorithms: ['RS256'],
      issuer: 'cosmos-gateway',
    }) as jwt.JwtPayload

    const rawAud = decoded.aud
    const aud = Array.isArray(rawAud) ? rawAud[0] : rawAud
    if (aud !== expectedAudience) {
      throw new ForbiddenException('Token audience mismatch for this service')
    }

    if (!decoded.sub || typeof decoded.sub !== 'string') {
      throw new UnauthorizedException('Invalid service token subject')
    }

    return {
      sub: decoded.sub,
      iss: String(decoded.iss ?? ''),
      aud,
      iat: decoded.iat,
      exp: decoded.exp,
    }
  } catch (e) {
    if (e instanceof ForbiddenException || e instanceof UnauthorizedException) {
      throw e
    }
    throw new UnauthorizedException('Invalid or expired service token')
  }
}

/** Mint a short-lived gateway→service JWT (gateway private key PEM). */
export function mintServiceJwtToken(params: {
  privateKeyPem: string
  callingService: string
  targetService: string
  ttlSeconds?: number
}): string {
  return jwt.sign(
    {
      sub: params.callingService,
      iss: 'cosmos-gateway',
      aud: params.targetService,
    },
    params.privateKeyPem,
    {
      algorithm: 'RS256',
      expiresIn: params.ttlSeconds ?? 300,
      jwtid: randomUUID(),
    },
  )
}
