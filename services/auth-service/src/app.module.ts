import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { PrismaModule } from './prisma/prisma.module'
import { HealthController } from './health/health.controller'
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
