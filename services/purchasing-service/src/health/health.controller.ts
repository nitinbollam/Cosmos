import { Controller, Get } from '@nestjs/common'
import { Public } from '@cosmos/auth-middleware'

@Controller()
export class HealthController {
  private startedAt = Date.now()

  @Public()
  @Get('health')
  health() {
    return {
      status: 'healthy',
      service: 'purchasing-service',
      version: process.env.npm_package_version ?? '1.0.0',
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      checks: { http: { status: 'pass' } },
    }
  }
}
