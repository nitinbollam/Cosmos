# Cosmos — Implementation Status & Gaps

Authoritative breakdown of what is **production-grade**, what is **scaffolded**, and what was **not produced** in this session. Use this to plan follow-up sessions.

## Path to production (what “ready” actually means here)

Cosmos mixes **shipping-quality services** with **thin UIs**, **thin AI wrappers**, **speculative infra**, and **organizational blanks** no repo can satisfy (legal, SLAs/OLAs, insurance, audited pen tests, tabletop DR, capacity targets, SOC2/KYC, etc.). **You cannot certify “production” from commits alone.**

**Technical gate before any release**: run **`pnpm prod:preflight`** from the repo root (lint + test + build via Turbo — same triple CI now executes in one step). Passing that only proves the monorepo compiles/tests under CI env defaults; **it is not evidence of HA, scalability, zero trust, or business continuity.**

**Program stance toward “fully production ready”**:

| Phase | Outcome examples |
|---|---|
| **P0 Ship** | Lockfiles committed, secrets externalized (ESO/AWS SM), JWT/Stripe keys rotated, no placeholder K8s secrets in prod overlays, **`prod:preflight` green**. |
| **P1 Run** | OTel exporters on **+** Grafana/Datadog boards, alerting on latency/error budgets, BullMQ exhaustion hooks (`pagerDutyDlqFromEnv`), runbooks linked from deploy docs. |
| **P2 Prove** | Saga + critical API integration/soak/load tests vs real Postgres/Redis topology; chaos or failure-injection drills; RTO/RPO numbers owned by the business. |
| **P3 Assure** | External security review + compliance attestations aligned to your regulators/customers — **not** something this codebase can automate. |

The tables below describe **engineering completeness** (“DONE” rows in this repo sense), **not** a finished enterprise compliance posture.

Legend:

- **DONE** — full implementation: validation, error handling, Prisma schema with indexes where needed, controllers, DTOs, health endpoint, Dockerfile, package.json, tsconfig, README. Tests where called out.
- **SCAFFOLD** — runnable shell only: NestJS/FastAPI bootstrap, `/health`, `package.json`/`requirements.txt`, Dockerfile, README describing what's missing.
- **TODO** — not produced this session.

---

## Foundation

| Item | Status |
|---|---|
| Monorepo root (turbo, pnpm, tsconfig.base, prettier, editorconfig, npmrc) | DONE |
| `docker-compose.yml` (Postgres 16, Redis 7, MinIO, OTel collector) | DONE |
| `infra/docker/init-db.sql` — one DB per service | DONE |
| `infra/docker/otel-config.yaml` | DONE |
| `.env.example` covering all services | DONE |
| `.github/workflows/ci.yml` | DONE |
| `.github/workflows/deploy-staging.yml` | DONE |
| `.github/workflows/deploy-production.yml` | DONE |
| `scripts/migrate-all.ts` | DONE |
| `scripts/seed-db.ts` (creates demo tenant + admin) | DONE |
| `scripts/generate-types.ts` | DONE |
| `scripts/ensure-nest-tracing.mjs` — Nest `tracing-bootstrap` + `@cosmos/tracing` dep | DONE |
| **`pnpm prod:preflight`** — `scripts/production-preflight.mjs` (Turbo lint·test·build gate) | DONE |
| `scripts/scaffold-service.ps1` & `scaffold-ai.ps1` (used to create the 11 service scaffolds) | DONE |

## packages/

| Package | Status | Notes |
|---|---|---|
| `@cosmos/logger` | DONE | Pino factory, AsyncLocalStorage correlation context, redaction |
| `@cosmos/config` | DONE | Zod env validation, base + AWS + Stripe + inter-service URL schemas |
| `@cosmos/types` | DONE | Shared cross-service types (JwtPayload, OrderStatus, etc.) |
| `@cosmos/event-bus` | DONE | Verbatim spec impl (events.ts + client.ts) + extended payload types + jest test |
| `@cosmos/auth-middleware` | DONE | NestJS JWT strategy + JwtAuthGuard + RolesGuard + decorators |
| `@cosmos/database` | DONE | Tenant isolation helpers + retry + Prisma error helpers |
| `@cosmos/validation` | DONE | Shared Zod schemas (cuid, email, address, UPC, pagination) |
| `@cosmos/ui` | DONE (basic) | Button, Card, StatsCard, cn helper. **No Radix integration, no charts library, no full design system; expand in follow-up.** |
| `@cosmos/tracing` | DONE | OTLP GRPC via **`bootstrapTelemetry`**, idle unless **`COSMOS_OTEL_ENABLED=true`**; wired from every Nest `main.ts`. |

## services/ — fully implemented (per spec)

| Service | Port | Status | Notes |
|---|---|---|---|
| `services/auth-service` | 3001 | DONE | JWT access+refresh, register/login/refresh/logout, full Prisma User/Tenant, DTOs, JwtAuthGuard, JwtRefreshGuard, RolesGuard, e2e test, unit tests, Dockerfile, README |
| `services/tenant-service` | 3002 | DONE | Tenant org + onboarding, Prisma migrations, `InternalOrJwtAuthGuard`, RolesGuard on admin routes, unit test, README |
| `services/inventory-service` | 3003 | DONE | StockLedgerEntry/StockLevel/SKU/Warehouse/StockReservation, receive/adjust/reserve/release/fulfill, reorder-point events, ReservationExpirer cron, controller, DTOs, unit test, Dockerfile · **`GET /skus/lookup/by-code?code=`**
| `services/wms-service` | 3004 | DONE (partial) | **Receiving sessions** (`POST /wms/receiving/sessions`, scan, get, complete) → inventory `receive` + optional PO `receive`; **cartons** (`POST /wms/tasks/:taskId/cartons`, items, seal stub label). **`RECEIVING_COMPLETED`** event + notification consumer. Jest: **`receiving.service.spec.ts`**, **`fulfillment.service.spec.ts`**. Remaining depth: carrier labels, deeper cycle-count if added later. |
| `services/order-service` | 3005 | DONE | Order/OrderLineItem/OrderSaga, saga with compensations, controller, DTOs, unit tests, Dockerfile |
| `services/purchasing-service` | 3006 | DONE | Supplier, PO + lines, status lifecycle, receive endpoint, `InternalOrJwtAuthGuard`, RolesGuard on submit/cancel, Jest spec, README |
| `services/compliance-service` | 3007 | DONE | MSA engine, S3, batch-expiry cron, Dockerfile |
| `services/storefront-service` | 3008 | DONE | **`POST quotes/:id/submit`** orchestrates **`convertedOrderId`** (+ Prisma migration) via Bearer-chained **`CRM` / `inventory` / `orders`**. |
| `services/pos-service` | 3009 | DONE | PosRegister, PosShift, PosSale (lines JSON), void, Jest spec, README |
| `services/crm-service` | 3010 | DONE | Customer, Lead, Activity (CALL/EMAIL/NOTE), convert lead, **`GET /customers/lookup?externalRef=`**, Jest spec, README |
| `services/dispatch-service` | 3011 | DONE | DeliveryRoute, RouteStop, assign driver; **optional POD body on deliver, `POST …/failed` stop failure;** Jest spec, README |
| `services/payment-service` | 3012 | DONE | Stripe adapter, LedgerEntry schema, webhook, **`Idempotency-Key` required on mutate routes (except webhooks)** , Dockerfile |
| `services/ledger-service` | 3013 | DONE | ChartAccount, JournalEntry + lines, balanced post, fiscalPeriod flag on entry, Jest spec, README |
| `services/analytics-service` | 3014 | DONE | DailyKpiSnapshot, `POST /internal/refresh`, Jest spec, README |
| `services/notification-service` | 3015 | DONE | NotificationRequest log, enqueue + POST send, idempotency header, dev stub SENT, Jest spec, README |
| `services/gateway-service` | 3000 | DONE (proxy) | **`bootstrapTelemetry('gateway-service')`** (opt-in OTel). **No Prisma.** `@nestjs/axios` streaming `_proxy/:service/...`, `@nestjs/throttler` + per-IP proxy limit (200/min), health `SkipThrottle`, README describes auth via proxy |

## services/ — scaffolded only

| Service | Port | Status | Follow-up needed |
|---|---|---|---|
| _(none newly listed here — previously scaffold services in this tranche are now implemented.)_ | | | |

## ai/

| Service | Port | Status | Notes |
|---|---|---|---|
| `ai/cosmos-llm` | 8001 | DONE | Verbatim spec impl. **No fine-tuned LoRA adapter — service falls back to base Mistral. Adapter training pipeline TODO.** |
| `ai/demand-forecasting` | 8002 | DONE | LSTMForecaster + HybridForecaster + ModelStore with **optional S3 persistence** (`MODEL_STORE_S3_BUCKET`, SSE-KMS/AES256 on put). Local `/tmp` (or `MODEL_STORE_DIR`) when bucket unset. |
| `ai/ocr-engine` | 8003 | DONE | Verbatim spec impl. **PaddleOCR weights download on first start; no fine-tuned wholesale-invoice weights.** |
| `ai/cashflow-model` | 8004 | DONE | `POST /forecast/cash-flow` with EWMA + optional seasonal damping (numpy); **still simple heuristics, not audited treasury model** |
| `ai/anomaly-detection` | 8005 | DONE | `POST /detect/series` robust MAD z-score + Tukey IQR; **not calibrated per-tenant KPI baselines yet** |

## apps/

| App | Port | Status | Notes |
|---|---|---|---|
| `apps/web-admin` | 4000 | DONE (partial) | Dashboard · **`/orders`** + **`/orders/[id]`** · **`/fulfillment`** + **`/fulfillment/[taskId]`** (`pack`/`dispatch`) · **`/inventory`**, **`/customers`**, **`/compliance`**, **`/finance`**. |
| `apps/web-storefront` | 4001 | DONE (thin B2B) | Landing **`/login`** · **`/quotes`** / **`new`** / **`[id]`** — submit creates **CRM customer + tenant order + `convertedOrderId`** when inter-service URLs and **skuCode per line + warehouse/SKUs exist**. Set **`NEXT_PUBLIC_WEB_ADMIN_ORIGIN`** to deep-link into Admin `/orders/[id]`. |
| `apps/mobile-warehouse` | — | DONE (partial) | Tasks + **`app/task/[id]`** pick quantities, offline enqueue via **`replayAction`/`queueAction`**, barcode scan (**camera permission requested on mount**); WatermelonDB + sync replay body shape `{ action, payload }`. **Receiving session UI depth still shallow.** |
| `apps/mobile-delivery` | — | DONE (partial) | **`/login`** + route tab demo seed, **POD text fields**, deliver/fail call dispatch API (+ **failed/[id]** with `routeId`); auth store hydrate. Location ping best-effort. **Offline queue + signature capture not done.** |
| `apps/mobile-sales` | — | DONE (partial) | Gateway auth + **Leads / Customers / New lead** tabs (`axios` + CRM `_proxy` paths). **`eas.json`** aligned with warehouse/delivery. Tune `EXPO_PUBLIC_GATEWAY_URL` for your env. |

## infra/

| Item | Status | Notes |
|---|---|---|
| `infra/docker/node-service.Dockerfile` | DONE | Verbatim from spec |
| `infra/docker/python-service.Dockerfile` | DONE | Verbatim from spec |
| `infra/docker/init-db.sql` | DONE | Creates one logical DB per service |
| `infra/docker/otel-config.yaml` | DONE | OTLP receivers + debug exporter |
| `infra/k8s/base/namespace.yaml` | DONE | |
| `infra/k8s/base/configmap.yaml` | DONE | URLs + **`COSMOS_OTEL_ENABLED`** / **`OTEL_EXPORTER_OTLP_ENDPOINT`** (point at your collector DNS). |
| `infra/k8s/base/secret.yaml` | DONE (placeholder) | Real secrets via External Secrets Operator + AWS Secrets Manager — TODO |
| `infra/k8s/base/auth-service.yaml` | DONE | Deployment+Service+HPA example |
| `infra/k8s/base/*.yaml` (gateway, tenant…notification) | DONE (generated) | **`pnpm exec node scripts/gen-k8s-services.mjs`** writes per-service Deployment+Service+HPA; overlay patches still skeletal. Tune images/resources per env. |
| `infra/k8s/examples/external-secret-storefront-database.yaml` | DONE (sample) | ESO **`ExternalSecret`** template targeting tenant DB URL (adjust `ClusterSecretStore` / remote paths). |
| `infra/k8s/base/kustomization.yaml` | DONE | Lists generated base manifests; review before production apply. |
| `infra/k8s/overlays/staging` | DONE (skeletal) | replicas=1 patch |
| `infra/k8s/overlays/production` | DONE (skeletal) | replicas=3 patch |
| `infra/terraform/modules/networking` | DONE | VPC + 3-AZ public/private subnets |
| `infra/terraform/modules/eks` | DONE | EKS 1.29 with general + GPU node groups |
| `infra/terraform/modules/rds` | DONE | Postgres 16, multi-AZ in production, encrypted, secured by VPC SG |
| `infra/terraform/modules/redis` | DONE | ElastiCache Redis 7.1, replication group, auto-failover in prod |
| `infra/terraform/modules/s3` | DONE | Versioned + encrypted + public-access blocked |
| `infra/terraform/environments/staging` | DONE | Wires modules together (S3 backend) |
| `infra/terraform/environments/production` | DONE | Production sizing |

---

## Quality-gate gaps to address in follow-up sessions

The spec's quality gates that this session does **not** fully satisfy — listing them honestly:

1. **80%+ unit test coverage on every service** — meaningful tests remain on auth, inventory, order, event-bus, tenant, purchasing, ledger, crm, dispatch, notification, analytics, storefront, pos, gateway (`parseProxyParts`). **`wms-service`** gains **`src/fulfillment/fulfillment.service.spec.ts`** (pack/dispatch/conflict/createTask); domain coverage is **still nowhere near 80%** across the fleet.
2. **Integration tests covering rollback paths in order-service saga** — **`order.saga.spec.ts`** exercises **inventory release** compensation when fulfillment creation fails (HTTP mocks). Still **TODO:** live integration against running inventory/payment/WMS Postgres+Redis stacks.
3. **DLQ alerting** — BullMQ workers get retry/backoff defaults in `packages/event-bus` (see **`attachWorkerDlqPagerDuty`**). **`notification-service`** subscribes to **`ORDER_CREATED`** with **`pagerDutyDlqFromEnv('notification-service')`** (PagerDuty fires only when **`PAGERDUTY_ROUTING_KEY`** is set). Additional domain consumers TBD.
4. **OpenTelemetry instrumentation in services** — **`packages/tracing`** exposes `bootstrapTelemetry()`; services opt in with **`COSMOS_OTEL_ENABLED=true`**. Wide rollout + span attributes parity still TODO.
5. **AWS Secrets Manager integration** — services read `process.env`. **`infra/k8s/examples/external-secret-storefront-database.yaml`** is one pattern; broaden to all workloads + IaC bindings.
6. **PagerDuty alerts** — env var present, only deploy-production workflow uses it. No runtime alert pipeline.
7. **Stripe webhook signing-secret rotation** — currently manual.
8. **Mobile offline conflict resolver** — `apps/mobile-warehouse/src/sync/conflict.resolver.ts` provides `resolveByUpdatedAt`; WatermelonDB sync still uses default paths — wire resolver into pull/push merge logic when custom merges are needed.
9. **Fine-tuned model artifacts** — Mistral LoRA adapter, OCR wholesale-invoice weights, demand-forecasting baseline checkpoints all need actual training runs.
10. **Per-service Prisma migrations** — `scripts/migrate-all.ts` includes all DB-backed services except gateway; **run `pnpm db:migrate` / migrate-all after pulling.**
11. **Service-to-service auth** — **partial:** saga calls can use shared `INTERNAL_SERVICE_SECRET` + tenant headers (`InternalOrJwtAuthGuard`). **Still TODO:** short-lived service JWTs, gateway minting, or mTLS (Linkerd/Istio).
12. **Rate limiting at gateway** — **partial:** `@nestjs/throttler` is registered globally; **`/api/v1/health` uses `SkipThrottle`.** `_proxy` traffic is throttled via in-proxy IP window (200/min) so proxied routes are covered; align Throttler storage with proxy if you need one unified backend later.
13. **Idempotency keys on payment endpoints** — **partial:** **`PaymentsIdempotencyRequiredGuard`** enforces **`Idempotency-Key`** on payment-service controllers (excluding webhooks); **order saga** forwards keys on authorize/void. Extend to any remaining payment mutations and callers.
14. **Lockfile + Turbo tooling** — commit `pnpm-lock.yaml` (`pnpm install` from root). **`pnpm` is pinned in root devDependencies;** **`pnpm exec turbo`** (same as **`pnpm run build:turbo`**) avoids “cannot find package manager binary” on Windows when invoking `turbo` outside pnpm's PATH.
15. **Mobile app native builds** — **`eas.json`** exists for **`mobile-warehouse`** and **`mobile-delivery`** (preview internal + production stubs). Tune credentials, profiles, OTA workflow.

## Suggested order for follow-up sessions

1. **`pnpm prod:preflight`** (or CI equivalent) · commit **`pnpm-lock.yaml`** (`pnpm install` from root).
2. `pnpm infra:up && pnpm db:migrate && pnpm seed`. Verify auth-service login works; exercise **gateway** `_proxy/auth/login` and a few domain services.
3. Harden OTel (default rollout policy, dashboards) + wire more ExternalSecrets + CI apply checks for **`infra/k8s/base`**.
4. Mobile: deepen **receiving**, offline/conflict merges, POD signature/image; **`mobile-sales`** app.
5. Web apps: charts, richer admin CRUD/edit flows; catalog/checkout if you widen storefront beyond B2B quotes.

## How to use this list

Pick any **TODO** row or any "Quality-gate gap" and start a new session with:

> *Implement `<area>` to the same depth as `services/auth-service` — full Prisma schema where applicable, controllers, services, DTOs, event consumers/publishers, unit tests, e2e test for the happy path.*

The scaffold's README points the next session at this file and gives the expected port + Dockerfile shape to match.
