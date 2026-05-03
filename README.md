# Cosmos

Production-grade, cloud-native ERP and distribution management platform for wholesale and regulated distribution industries (tobacco, vape, general wholesale).

A monorepo containing:

- **`apps/`** — web frontends (Next.js 14) and mobile apps (Expo SDK 51)
- **`services/`** — NestJS 10 microservices (Postgres + Prisma + Redis/BullMQ)
- **`ai/`** — Python 3.11 / FastAPI ML services (Mistral 7B LoRA, LSTM+Prophet, PaddleOCR)
- **`packages/`** — shared TypeScript packages (event-bus, logger, config, types, auth, ui)
- **`infra/`** — Docker, Kubernetes (Kustomize), Terraform (AWS EKS + RDS + Redis + S3)

## Prerequisites

- Node.js >= 20
- pnpm >= 9 (`corepack enable && corepack prepare pnpm@9.7.0 --activate`)
- Python >= 3.11 (for AI services)
- Docker + Docker Compose
- (Optional) AWS CLI for infra

## Quickstart

```bash
# 1. Install all JS deps
pnpm install

# 2. Bring up Postgres 16, Redis 7, MinIO (S3 dev), OTel collector
pnpm infra:up

# 3. Copy and edit env
cp .env.example .env

# 4. Generate Prisma clients and run migrations across services
pnpm db:generate
pnpm db:migrate

# 5. Run everything
pnpm dev
```

## Service ports (dev)

| Service | Port | Stack |
|---|---|---|
| gateway-service | 3000 | NestJS |
| auth-service | 3001 | NestJS |
| tenant-service | 3002 | NestJS |
| inventory-service | 3003 | NestJS |
| wms-service | 3004 | NestJS |
| order-service | 3005 | NestJS |
| purchasing-service | 3006 | NestJS |
| compliance-service | 3007 | NestJS |
| storefront-service | 3008 | NestJS |
| pos-service | 3009 | NestJS |
| crm-service | 3010 | NestJS |
| dispatch-service | 3011 | NestJS |
| payment-service | 3012 | NestJS |
| ledger-service | 3013 | NestJS |
| analytics-service | 3014 | NestJS |
| notification-service | 3015 | NestJS |
| cosmos-llm | 8001 | FastAPI |
| demand-forecasting | 8002 | FastAPI |
| ocr-engine | 8003 | FastAPI |
| cashflow-model | 8004 | FastAPI |
| anomaly-detection | 8005 | FastAPI |
| web-admin | 4000 | Next.js |
| web-storefront | 4001 | Next.js |

## Implementation status

See `MISSING.md` for a precise breakdown of which modules are production-grade vs. scaffolded.

## License

Proprietary — FastFlyrr Technology Group.
