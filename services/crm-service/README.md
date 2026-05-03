# crm-service

Customers, leads, activities. Port **3010**, database **cosmos_crm**.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/health` | Public |
| CRUD | `/api/v1/customers` | Tenant-scoped customers |
| CRUD | `/api/v1/leads` | Leads; **POST** `/:id/convert` (**TENANT_ADMIN** / **SUPER_ADMIN**) creates customer + links |
| GET/POST | `/api/v1/activities` | List (optional `?customerId=` / `?leadId=`); create requires `customerId` and/or `leadId` |

Activity `type`: **CALL** | **EMAIL** | **NOTE**.

## Build

`pnpm --filter @cosmos/crm-service build`
