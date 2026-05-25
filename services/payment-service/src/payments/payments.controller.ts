import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { PaymentsService } from './payments.service'
import { AuthorizeDto, CaptureDto, RefundDto, VoidDto } from './dto'
import { StripeAdapter } from './stripe.adapter'
import { Public } from '@cosmos/auth-middleware'
import { logger } from '@cosmos/logger'
import { Request, Response } from 'express'
import { PaymentsIdempotencyRequiredGuard } from './guards/payments-idempotency-required.guard'
import { PaymentIdempotencyService } from './payment-idempotency.service'

@UseGuards(PaymentsIdempotencyRequiredGuard)
@Controller('payments')
export class PaymentsController {
  constructor(
    private payments: PaymentsService,
    private stripe: StripeAdapter,
    private paymentIdempotency: PaymentIdempotencyService,
  ) {}

  @Post('authorize')
  @HttpCode(HttpStatus.OK)
  async authorize(
    @Req() req: Request & { user: { tenantId: string } },
    @Res({ passthrough: true }) res: Response,
    @Body() dto: AuthorizeDto,
  ) {
    const key = `${req.headers['idempotency-key'] ?? ''}`.trim()
    const cached = key ? await this.paymentIdempotency.get(key) : null
    if (cached) {
      res.status(cached.status)
      return cached.body
    }
    const result = await this.payments.authorize(req.user.tenantId, dto)
    if (key) {
      await this.paymentIdempotency.set(key, HttpStatus.OK, result)
    }
    return result
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
  @Get('webhook/stripe/status')
  stripeWebhookStatus() {
    return this.stripeStatusPayload()
  }

  @Public()
  @Get('stripe/status')
  stripeIntegrationStatus() {
    return this.stripeStatusPayload()
  }

  private stripeStatusPayload() {
    return {
      webhookSigningSecretConfigured: this.stripe.isWebhookSecretConfigured(),
      rotation:
        'Create a new signing secret in Stripe Dashboard → Webhooks → endpoint → Reveal; update STRIPE_WEBHOOK_SECRET (e.g. via External Secrets) and roll out; then remove the old secret in Stripe.',
    }
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
