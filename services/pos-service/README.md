# pos-service

Registers, shifts, and sales. Port **3009**, database **cosmos_pos**.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/health` | Public |
| GET | `/api/v1/registers` | List |
| POST | `/api/v1/registers` | Create (**admin**) |
| POST | `/api/v1/shifts/open` | Open shift (registerId, openingCash, openedBy) |
| POST | `/api/v1/shifts/:id/close` | Close shift (closingCash, closedBy) |
| GET | `/api/v1/sales?shiftId=` | List sales |
| POST | `/api/v1/sales` | Record sale (`lines` JSON array in model + `total`, `saleRef`) |
| POST | `/api/v1/sales/:id/void` | Void flag + reason |

## Build

`pnpm --filter @cosmos/pos-service build`
