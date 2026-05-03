import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'

@Injectable()
export class ServiceJwtFactory {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Mint RS256 token for downstream `aud` (e.g. `order-service`). Null if private key not configured. */
  async mintTargetAudience(targetAudience: string): Promise<string | null> {
    const rawKey = this.config.get<string>('GATEWAY_SERVICE_JWT_PRIVATE_KEY')?.trim()
    if (!rawKey) return null

    const privateKey = Buffer.from(rawKey, 'base64').toString('utf-8')

    return this.jwtService.signAsync(
      {
        sub: 'gateway-service',
        iss: 'cosmos-gateway',
        aud: targetAudience,
        jti: randomUUID(),
      },
      { privateKey, algorithm: 'RS256', expiresIn: '5m' },
    )
  }
}
