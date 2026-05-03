# wms-service

Warehouse Management — fulfillment tasks for order saga integration, floor tasks API, and mobile sync endpoints.

**Port:** 3004 · **Global prefix:** `/api/v1`

## Implemented

- Prisma: `FulfillmentTask`, `PickLine`, enums for task/pick status
- **JWT or internal headers** — same pattern as inventory/order (`InternalOrJwtAuthGuard` + `INTERNAL_SERVICE_SECRET`)
- `POST /fulfillment/tasks` — create pick task + publish `wms.pick_list_created`
- `DELETE /fulfillment/tasks/:orderId` — cancel task + publish `wms.pick_list_completed` (idempotent if missing)
- `POST /fulfillment/tasks/:taskId/pack` — all lines **PICKED**/**SHORT** → **PACKED** + emit `wms.shipment_packed`
- `POST /fulfillment/tasks/:taskId/dispatch` — **PACKED** → **DISPATCHED** + emit `wms.shipment_dispatched` and `wms.pick_list_completed` (outcome `DISPATCHED`)
- `GET /wms/tasks/:taskId` — task + pick lines for mobile floor UX
- `GET /sync/pull?since=` — Watermelon-friendly pull payload
- `POST /sync/push` — accepts push body (stub acknowledgement)
- `POST /sync/replay` — offline queue replay (`pick_progress`, …)
- `pnpm test` — Prisma generate + **Jest** (`fulfillment.service.spec.ts`; extend coverage over time)

## Not yet in scope

- Full packing station UI hooks, cartonization, barcode allocation rules, receiving depth
- E2E against running Postgres + Redis
- Event **consumers** (subscribe handlers) beyond publishing from mutations

## Env

Uses `DATABASE_URL` for logical DB `cosmos_wms`, `REDIS_URL` for BullMQ, `JWT_SECRET`, and optional `INTERNAL_SERVICE_SECRET` for saga calls.

## Scripts

```bash
pnpm db:generate
pnpm db:migrate   # deploy migrations
pnpm db:dev       # create dev migrations
pnpm test         # prisma generate + Jest (see src/fulfillment/*.spec.ts)
```
