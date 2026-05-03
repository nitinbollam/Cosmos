import { Controller, Get } from '@nestjs/common'
import { Public } from '@cosmos/auth-middleware'

@Public()
@Controller()
export class HealthController {
  private startedAt = Date.now()

  @Get('health')
  health() {
    return {
      status: 'healthy',
      service: 'wms-service',
      version: process.env.npm_package_version ?? '1.0.0',
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      checks: { http: { status: 'pass' } },
    }
  }
}
