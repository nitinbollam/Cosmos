import { Controller, Get } from '@nestjs/common'
import { Public } from '../auth/guards/jwt-auth.guard'

@Controller()
export class HealthController {
  private startedAt = Date.now()

  @Public()
  @Get('health')
  health() {
    return {
      status: 'healthy',
      service: 'auth-service',
      version: process.env.npm_package_version ?? '1.0.0',
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      checks: { http: { status: 'pass' } },
    }
  }
}
