# purchasing-service

Purchase orders, suppliers, and receiving. Port **3006**, database **cosmos_purchasing**.

## Auth

All routes except `GET /api/v1/health` require JWT (Bearer), `x-service-token` + `x-cosmos-tenant-id`, or internal headers per `InternalOrJwtAuthGuard`.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/health` | Public |
| GET | `/api/v1/suppliers` | List suppliers for tenant |
| GET | `/api/v1/suppliers/:id` | Get supplier |
| POST | `/api/v1/suppliers` | Create supplier |
| PATCH | `/api/v1/suppliers/:id` | Update supplier |
| GET | `/api/v1/purchase-orders?status=` | List POs, optional status filter |
| GET | `/api/v1/purchase-orders/:id` | Get PO with lines |
| POST | `/api/v1/purchase-orders` | Create draft PO + lines |
| POST | `/api/v1/purchase-orders/:id/submit` | DRAFT → SUBMITTED (**TENANT_ADMIN** / **SUPER_ADMIN**) |
| POST | `/api/v1/purchase-orders/:id/cancel` | Cancel if not partially received (**TENANT_ADMIN** / **SUPER_ADMIN**) |
| POST | `/api/v1/purchase-orders/:id/receive` | Receive goods; increments `qtyReceived`, updates status toward PARTIALLY_RECEIVED / CLOSED |

PO status lifecycle: **DRAFT → SUBMITTED → PARTIALLY_RECEIVED / CLOSED**, or **CANCELLED** (from DRAFT or SUBMITTED only).

## Build

```bash
pnpm --filter @cosmos/purchasing-service build
```
