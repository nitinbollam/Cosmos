# storefront-service

B2B quotes. Port **3008**, database **cosmos_storefront**.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/health` | Public |
| GET | `/api/v1/quotes` | List (`?status=OPEN|SUBMITTED|EXPIRED`) |
| GET | `/api/v1/quotes/:id` | Detail + lines |
| POST | `/api/v1/quotes` | Create OPEN quote + lines (`customerRef` string) |
| POST | `/api/v1/quotes/:id/submit` | **TENANT_ADMIN / SUPER_ADMIN** — forwards caller **Bearer** to inventory (SKU **by-code**, warehouses), CRM ( **`GET customers/lookup?externalRef=`** stub create), **`POST orders`**; persists **`convertedOrderId`**. **Every quote line needs `skuCode`.** Requires env **`ORDER_SERVICE_URL`**, **`INVENTORY_SERVICE_URL`**, **`CRM_SERVICE_URL`** on this service.

## Prerequisites for quote→order

- Tenant has at least **one warehouse** (default-flag preferred).
- Every **quote line** includes **`skuCode`** matching an SKU **code** in inventory.
- `customerRef` maps to **`Customer.externalRef`** in CRM where possible; otherwise a stub CRM customer is created.

## Build

`pnpm --filter @cosmos/storefront-service build`
