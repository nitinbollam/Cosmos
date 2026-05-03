import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common'
import { PaymentsService } from './payments.service'
import { AuthorizeDto, CaptureDto, RefundDto, VoidDto } from './dto'
import { StripeAdapter } from './stripe.adapter'
import { Public } from '@cosmos/auth-middleware'
import { logger } from '@cosmos/logger'
import { Request } from 'express'
import { PaymentsIdempotencyRequiredGuard } from './guards/payments-idempotency-required.guard'

@UseGuards(PaymentsIdempotencyRequiredGuard)
@Controller('payments')
export class PaymentsController {
  constructor(
    private payments: PaymentsService,
    private stripe: StripeAdapter,
  ) {}

  @Post('authorize')
  @HttpCode(HttpStatus.OK)
  authorize(@Req() req: { user: { tenantId: string } }, @Body() dto: AuthorizeDto) {
    return this.payments.authorize(req.user.tenantId, dto)
  }

  @Post('capture')
  @HttpCode(HttpStatus.OK)
  capture(@Req() req: { user: { tenantId: string } }, @Body() dto: CaptureDto) {
    return this.payments.capture(req.user.tenantId, dto.paymentIntentId, dto.correlationId)
  }

  @Post('void')
  @HttpCode(HttpStatus.OK)
  voidIntent(@Req() req: { user: { tenantId: string } }, @Body() dto: VoidDto) {
    return this.payments.voidIntent(req.user.tenantId, dto.paymentIntentId, dto.correlationId)
  }

  @Post('refund')
  @HttpCode(HttpStatus.OK)
  refund(@Req() req: { user: { tenantId: string } }, @Body() dto: RefundDto) {
    return this.payments.refund(req.user.tenantId, dto.paymentIntentId, dto.amount, dto.correlationId)
  }

  @Public()
  @Post('webhook/stripe')
  @HttpCode(HttpStatus.OK)
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string) {
    if (!req.rawBody) {
      logger.error('stripe webhook missing raw body — disable rawBody:false in main.ts')
      return { received: false }
    }
    try {
      const event = this.stripe.verifyWebhook(req.rawBody, signature)
      logger.info({ type: event.type }, 'stripe webhook ok')
      return { received: true }
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'stripe webhook verification failed')
      return { received: false }
    }
  }
}
