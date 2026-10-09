# Pleros

Wholesale / distribution ERP — admin back office, B2B buyer portal, and field mobile PWAs on **one origin**.

| Layer | Stack | Path |
|-------|--------|------|
| UI | Vite + React Router | `apps/client` |
| API | Express + Prisma | `apps/web` → `/api/v1` |
| Data | SQLite (local) or Postgres (production) | `apps/web/.data` / `DATABASE_URL` |

**Local app:** [http://localhost:4000](http://localhost:4000) — SPA and API together.

Requires **Node.js ≥ 20** and **npm ≥ 10**.

---

## How to use the application

### Surfaces

| Surface | URL | Who |
|---------|-----|-----|
| Landing | `/` | Everyone — role-based entry |
| Admin ERP | `/admin` | Staff (inventory, orders, WMS, finance, CRM, POS, settings) |
| B2B shop | `/catalog`, `/cart`, `/checkout`, `/orders` | Buyer accounts |
| Mobile PWA | `/m/warehouse`, `/m/delivery`, `/m/sales` | Warehouse, drivers, sales |
| Signup | `/signup` | New distributor tenant |
| Verify email | `/verify-email` | New signups (required before login) |

### Demo accounts (local seed only)

After `npm run seed`:

| Role | Email | Password | Entry |
|------|-------|----------|-------|
| Admin | `admin@pleros.local` | `admin1234` | `/admin/login` |
| B2B buyer | `buyer@acme-retail.com` | `buyer1234` | `/login` |
| Warehouse | `warehouse@pleros.local` | `warehouse1234` | `/m/warehouse` |
| Driver | `driver@pleros.local` | `driver1234` | `/m/delivery` |
| Sales | `sales@pleros.local` | `sales1234` | `/m/sales` |

These exist only in your local database. **Production** tenants come from `/signup`; staff join via admin invites (`/accept-invite`).

### Typical flows

1. **Admin** — Sign in → dashboard → inventory / orders / warehouse / finance / CRM / POS / Celestial AI.
2. **New tenant** — `/signup` → verify email → `/admin/login` → onboarding (org, billing, warehouse, compliance).
3. **B2B buyer** — Catalog → cart → checkout (NET terms or Stripe card) → orders / invoices / quotes.
4. **POS** — `/admin/pos` → register + cart → age attestation when selling restricted SKUs → complete sale.
5. **Mobile** — Install PWA from `/m/*` → pick / receive / deliver (POD) / sales activities.
6. **Age verification** (when enabled in Settings → Company) — B2B blocks unlicensed buyers on tobacco/age-restricted SKUs; POS requires ID/DOB attestation; delivery POD requires age confirmation.

### Themes

Toggle in any header (persisted per browser):

| Theme | Style |
|-------|--------|
| **Obsidian** (default) | Matte black enterprise |
| **Aurora** | Light wholesale palette |

---

## Local development

```bash
npm install
cp .env.example .env
# Set JWT_SECRET and JWT_REFRESH_SECRET to long random values

npm run db:setup      # SQLite files under apps/web/.data
npm run db:generate
npm run db:migrate
npm run seed          # demo tenant + accounts above
npm run dev           # http://localhost:4000
```

### Local env essentials

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Required |
| `APP_URL` | Default `http://localhost:4000` — used in verify/reset/invite links |
| `SENDGRID_API_KEY` | Optional locally. Without it, emails log to the console; signup/resend may return a clickable `verifyUrl` for QA |
| Stripe / Celestial keys | Optional — card checkout and AI work in mock/dev modes without live keys |

### Postgres instead of SQLite

```bash
PLEROS_DB_PROVIDER=postgres npm run db:setup:postgres
# then migrate + seed as usual
```

Health: `GET /api/v1/health/db`.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite HMR + API on **:4000** |
| `npm run build` | Production build (all workspaces) |
| `npm run start -w @pleros/client` | Serve built SPA + API |
| `npm run test` | Workspace tests |
| `npm run typecheck` | TypeScript across workspaces |
| `npm run seed` | Load demo data |
| `npm run db:migrate` | Push all Prisma schemas |
| `npm run prod:preflight` | lint → test → build |

---

## Production

Treat production as a real SaaS deployment: strong secrets, Postgres, email delivery, and a public `APP_URL`.

### Required configuration

Copy [`.env.production.example`](.env.production.example) and set at least:

| Variable | Notes |
|----------|--------|
| `NODE_ENV=production` | Enables production auth behavior (no `verifyUrl` in API responses) |
| `APP_URL` | Public HTTPS origin, e.g. `https://app.your-domain.com` |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Long random secrets (not the example values) |
| `PLEROS_DB_PROVIDER=postgres` + DB URLs | Prefer Postgres over SQLite |
| `SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL` | Real verification, invite, and password-reset emails |
| Stripe live keys | Card checkout + SaaS billing (if used) |

Without SendGrid in production, signup still creates accounts and blocks login until verified — but users will not receive email. Configure SendGrid before go-live.

### Deploy outline

1. Set production env / secrets (never commit real keys).
2. `npm ci && npm run build`
3. Run migrations: `npm run db:migrate` (with production DB URLs).
4. Start: `npm run start -w @pleros/client` (or your process manager / container).
5. Smoke-test: signup → verify email → admin login → onboarding; demo seed is **not** for production.

Optional: Docker Compose / K8s / Terraform under `infra/` and `docker-compose*.yml`. See [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) for security hardening status.

### Vite build-time env (Stripe / gateway)

Checkout and invoice card pay use `import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY`, which Vite **inlines at build time**. For Docker / Render:

| Variable | Staging | Production | Notes |
|----------|---------|------------|--------|
| `VITE_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` | `pk_live_…` | Required — avoids “Missing VITE_STRIPE_PUBLISHABLE_KEY” |
| `VITE_GATEWAY_URL` | `/api/v1` | `/api/v1` | Default OK for same-origin |
| `VITE_WEB_ADMIN_ORIGIN` | optional | optional | Absolute admin origin if needed |

- Dockerfile: `ARG`/`ENV` before `npm run build -w @pleros/client` ([`apps/web/Dockerfile`](apps/web/Dockerfile)).
- Render: set the same keys on each service in [`render.yaml`](render.yaml); clear-cache redeploy after changes.
- Compose: pass via `build.args` in [`docker-compose.production.yml`](docker-compose.production.yml).
- GHA: `--build-arg` from `secrets.VITE_STRIPE_PUBLISHABLE_KEY` (and optional `VITE_WEB_ADMIN_ORIGIN`).

### Production identity model

- **New company:** `/signup` → email verification → onboarding.
- **Join existing tenant:** admin invite → `/accept-invite` (auto-verified).
- **Buyers:** CRM customer + “Invite to buyer portal”, or email match on invite accept.
- **Age verification:** enable per tenant in Settings → Company → Age verification.

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md) | Security / go-live checklist |
| [`PLATFORM_FEATURES.md`](PLATFORM_FEATURES.md) | Feature reference and tier changelog |
| [`ERP_FEATURE_GAP.md`](ERP_FEATURE_GAP.md) | Roadmap vs industry ERPs |
| [`MISSING.md`](MISSING.md) | Short infra backlog |
| [`docs/TESTING_FLOW.html`](docs/TESTING_FLOW.html) | Interactive Neobrutalism Testing Knowledge Base Website |
| [`docs/TESTING_FLOW.md`](docs/TESTING_FLOW.md) | Comprehensive end-to-end testing flow & QA master guide |
| [`docs/QA_STAGING_CHECKLIST.md`](docs/QA_STAGING_CHECKLIST.md) | Staging QA pass (auth, admin, buyer, mobile, billing, copy) |
| [`docs/celestial/`](docs/celestial/) | Celestial AI knowledge base |

## License

Proprietary — FastFlyrr Technology Group.
