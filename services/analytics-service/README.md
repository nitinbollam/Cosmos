# analytics-service

Daily KPI snapshots. Port **3014**, database **cosmos_analytics**.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/health` | Public |
| GET | `/api/v1/kpi/snapshots` | Tenant’s daily rows |
| POST | `/api/v1/internal/refresh` | Upsert one day from JSON body (**TENANT_ADMIN** / **SUPER_ADMIN**). `tenantId` in body allowed only for **SUPER_ADMIN** (cross-tenant refresh). |

Body: `{ "date": "2026-05-01", "ordersCount": 0, "revenue": 0, "skusActive": 0, "tenantId?": "..." }`

## Build

`pnpm --filter @cosmos/analytics-service build`
