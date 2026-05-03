import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common'

/**
 * Stripe-style idempotency: mutating `/payments/*` (except webhook) must send `Idempotency-Key`.
 * Works with `@cosmos/idempotency` Redis replay when REDIS_URL is valid.
 */
@Injectable()
export class PaymentsIdempotencyRequiredGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const url = `${(req.originalUrl ?? (req as { url?: string }).url ?? '')}`.toLowerCase()
    if (url.includes('/webhook')) return true

    const key = req.headers['idempotency-key'] as string | undefined
    if (!key?.trim()) {
      throw new BadRequestException(
        'Idempotency-Key header is required for payment mutations.',
      )
    }
    return true
  }
}
