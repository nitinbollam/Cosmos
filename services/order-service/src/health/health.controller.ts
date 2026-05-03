import { Controller, Get } from '@nestjs/common'

@Controller()
export class HealthController {
  private startedAt = Date.now()
  @Get('health')
  health() {
    return {
      status: 'healthy',
      service: 'order-service',
      version: process.env.npm_package_version ?? '1.0.0',
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      checks: { http: { status: 'pass' } },
    }
  }
}
