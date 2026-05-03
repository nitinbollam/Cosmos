# auth-service

JWT-based authentication for the Cosmos platform.

## Endpoints

| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/api/v1/auth/register` | public | `{ tenantId, email, password, firstName, lastName, role? }` |
| POST | `/api/v1/auth/login` | public | `{ email, password }` |
| POST | `/api/v1/auth/refresh` | refresh JWT | — |
| POST | `/api/v1/auth/logout` | access JWT | — |
| GET | `/api/v1/users` | access JWT | list users in tenant |
| GET | `/api/v1/users/:id` | access JWT | get user |
| POST | `/api/v1/users` | TENANT_ADMIN | create user |
| PATCH | `/api/v1/users/:id` | TENANT_ADMIN | update user |
| DELETE | `/api/v1/users/:id` | TENANT_ADMIN | deactivate user |
| GET | `/api/v1/health` | public | health |

## Local

```bash
pnpm --filter @cosmos/auth-service db:generate
pnpm --filter @cosmos/auth-service db:dev
pnpm --filter @cosmos/auth-service start:dev
```

Default port: **3001**.
