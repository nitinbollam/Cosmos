import { Controller, Get } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from '@cosmos/auth-middleware'

@Controller()
export class HealthController {
  private startedAt = Date.now()

  @Public()
  @SkipThrottle()
  @Get('health')
  health() {
    return {
      status: 'healthy',
      service: 'gateway-service',
      version: process.env.npm_package_version ?? '1.0.0',
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      checks: { http: { status: 'pass' } },
    }
  }
}
