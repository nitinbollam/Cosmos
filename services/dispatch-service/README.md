# dispatch-service

Delivery routes and stops. Port **3011**, database **cosmos_dispatch**.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/health` | Public |
| GET/POST | `/api/v1/routes` | List / create (with ordered stops + `address` JSON) |
| GET | `/api/v1/routes/:id` | Detail + stops |
| PATCH | `/api/v1/routes/:id/driver` | Assign driver, set route **IN_PROGRESS** (**admin**) |
| POST | `/api/v1/routes/:routeId/stops/:stopId/delivered` | Mark stop **DELIVERED**; completes route when all stops delivered |

## Build

`pnpm --filter @cosmos/dispatch-service build`
