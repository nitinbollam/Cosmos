import { Module } from '@nestjs/common'
import { PaymentsController } from './payments.controller'
import { PaymentsService } from './payments.service'
import { StripeAdapter } from './stripe.adapter'
import { LedgerService } from './ledger.service'
import { PaymentsIdempotencyRequiredGuard } from './guards/payments-idempotency-required.guard'

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeAdapter, LedgerService, PaymentsIdempotencyRequiredGuard],
  exports: [PaymentsService, LedgerService],
})
export class PaymentsModule {}
