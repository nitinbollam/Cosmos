# notification-service

Notification request log + stub send path. Port **3015**, database **cosmos_notification**.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/health` | Public |
| GET | `/api/v1/notifications` | Recent rows for tenant |
| POST | `/api/v1/notifications/send` | Body: channel, recipient, templateKey, optional payload. Optional `Idempotency-Key` header dedupes per tenant. |

Stub: rows move to **SENT** without calling SendGrid (suitable for dev); extend `deliverRecord` for real transports later.

## Build

`pnpm --filter @cosmos/notification-service build`
