# ledger-service

General ledger: chart of accounts and journal entries. Port **3013**, database **cosmos_ledger**.

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/health` | Public |
| GET/POST | `/api/v1/chart-accounts` | List / create (**admin** for create) |
| GET/PATCH | `/api/v1/chart-accounts/:id` | Get / patch (**admin** for patch) |
| GET/POST | `/api/v1/journal-entries` | List / create draft (balanced lines enforced) |
| GET | `/api/v1/journal-entries/:id` | Detail |
| POST | `/api/v1/journal-entries/:id/post` | Mark posted (re-validates balance) |

Account `type`: `ASSET` | `LIABILITY` | `EQUITY` | `REVENUE` | `EXPENSE`. Each journal line must have debit **or** credit (not both). Sum of debits must equal sum of credits on create and on post.

## Build

`pnpm --filter @cosmos/ledger-service build`
