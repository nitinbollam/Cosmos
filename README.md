# Pleros

ERP and distribution platform — **Vite** (UI + API) on **one port**.

## Architecture

| Layer | Stack | URL |
|-------|--------|-----|
| UI | Vite + React Router (`apps/client`) | same origin |
| API | Express + Prisma + SQLite (`apps/web/lib/server`) | `/api/*` |

**Dev & prod:** http://localhost:4000 — SPA and `/api/v1` together.

## Quickstart

```bash
npm install
cp .env.example .env
npm run db:setup
npm run db:generate
npm run db:migrate
npm run seed
npm run dev
```

- **App:** http://localhost:4000 (landing page with role-based entry points)
- **Admin:** http://localhost:4000/admin/login — `admin@pleros.local` / `admin1234`
- **B2B buyer:** http://localhost:4000/login — `buyer@acme-retail.com` / `buyer1234`
- **Mobile (warehouse/delivery/sales):** http://localhost:4000/m/login

> The credentials above come from `npm run seed` and exist only in your local SQLite database. Production tenants are created via `/signup`; team members join via admin-issued invites (`/accept-invite`). See `PRODUCTION_READINESS.md` for the security/hardening status.

Dev uses Vite middleware (HMR) plus the embedded API server — no separate Next.js process.

### UI themes

Two switchable themes (toggle in any header; persisted per browser):

| Theme | Style |
|-------|-------|
| **Obsidian** (default) | Matte black, minimal enterprise |
| **Aurora** | Light purple wholesale palette |

### Database

Local dev uses **SQLite** (`apps/web/.data/*.db`). For Postgres:

```bash
PLEROS_DB_PROVIDER=postgres npm run db:setup:postgres
```

Health check: `GET /api/v1/health/db`.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server + API on **:4000** |
| `npm run sync:client` | Re-sync UI from legacy `apps/web` sources → `apps/client` |
| `npm run build` | Production Vite build + Prisma generate |
| `npm run start -w @pleros/client` | Serve `dist/` + API (after build) |

Requires **Node.js ≥ 20** and **npm ≥ 10**. Database: `apps/web/.data/*.db`.

## License

Proprietary — FastFlyrr Technology Group.
