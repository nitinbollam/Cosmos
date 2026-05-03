import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { ServiceJwtFactory } from './service-jwt.factory'

@Module({
  imports: [JwtModule.register({})],
  providers: [ServiceJwtFactory],
  exports: [ServiceJwtFactory],
})
export class ServiceJwtModule {}
