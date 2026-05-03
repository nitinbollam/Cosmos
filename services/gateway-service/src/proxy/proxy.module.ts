import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ProxyService } from './proxy.service'
import { ServiceJwtModule } from '../service-jwt/service-jwt.module'

@Module({
  imports: [
    HttpModule.register({
      timeout: 120_000,
      maxRedirects: 0,
    }),
    ServiceJwtModule,
  ],
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
