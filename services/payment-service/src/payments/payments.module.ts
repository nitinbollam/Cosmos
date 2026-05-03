import { Module } from '@nestjs/common'
import { PaymentsController } from './payments.controller'
import { PaymentsService } from './payments.service'
import { StripeAdapter } from './stripe.adapter'
import { LedgerService } from './ledger.service'
import { PaymentsIdempotencyRequiredGuard } from './guards/payments-idempotency-required.guard'
import { PaymentIdempotencyService } from './payment-idempotency.service'
import { PrismaModule } from '../prisma/prisma.module'
import { IdempotencyModule } from '@cosmos/idempotency'

@Module({
  imports: [
    PrismaModule,
    IdempotencyModule.register({
      redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    }),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    StripeAdapter,
    LedgerService,
    PaymentsIdempotencyRequiredGuard,
    PaymentIdempotencyService,
  ],
  exports: [PaymentsService, LedgerService],
})
export class PaymentsModule {}
