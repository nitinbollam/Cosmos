# gateway-service

API edge proxy with rate limiting. Port **3000**. **No database / Prisma.**

## Routing

- Global prefix: `api/v1`
- Forwarding: any request whose path matches `GET|POST|… /api/v1/_proxy/<service>/<rest>` is proxied to `<SERVICE_URL>/api/v1/<rest>` with streaming response.

Supported `<service>` keys (from env): `auth`, `tenant`, `inventory`, `wms`, `order`, `purchasing`, `compliance`, `storefront`, `pos`, `crm`, `dispatch`, `payment`, `ledger`, `analytics`, `notification`.

Example: `POST http://localhost:3000/api/v1/_proxy/auth/login` → `AUTH_SERVICE_URL/api/v1/login`.

Forwarded headers include `Authorization`, `Content-Type`, `x-cosmos-tenant-id`, `x-cosmos-internal-key`, `Idempotency-Key`, `x-service-token`, and correlation headers.

## Auth via proxy

The gateway does **not** require its own JWT. Downstream **auth-service** still validates credentials on protected routes; **`/api/v1/auth/register`** and **`/api/v1/auth/login`** remain public on auth-service and work through `_proxy/auth/...`.

## Other

- `GET /api/v1/health` is public and excluded from throttling.
- Global throttling: **200 requests / 60s** per default Throttler IP key (adjust in `app.module.ts`).

## Build

`pnpm --filter @cosmos/gateway-service build`
