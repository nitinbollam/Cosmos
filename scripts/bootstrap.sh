#!/usr/bin/env bash
# Cosmos first-time bootstrap. Run once after clone.
# Usage: bash scripts/bootstrap.sh
set -euo pipefail

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     COSMOS BOOTSTRAP — FIRST RUN         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

echo "[1/6] Installing dependencies..."
pnpm install

echo "[2/6] Starting infrastructure (Postgres, Redis, MinIO)..."
docker compose -f docker-compose.yml up -d postgres redis minio
echo "      Waiting for Postgres to be healthy..."
until docker compose -f docker-compose.yml exec -T postgres pg_isready -U cosmos -d cosmos > /dev/null 2>&1; do
  sleep 2
done
echo "      Postgres is ready."

echo "[3/6] Generating Prisma clients..."
node scripts/generate-all-prisma.mjs

echo "[4/6] Running database migrations..."
DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_auth \
  pnpm exec prisma migrate deploy --schema=services/auth-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_tenant \
  pnpm exec prisma migrate deploy --schema=services/tenant-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_inventory \
  pnpm exec prisma migrate deploy --schema=services/inventory-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_wms \
  pnpm exec prisma migrate deploy --schema=services/wms-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_order \
  pnpm exec prisma migrate deploy --schema=services/order-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_purchasing \
  pnpm exec prisma migrate deploy --schema=services/purchasing-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_compliance \
  pnpm exec prisma migrate deploy --schema=services/compliance-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_storefront \
  pnpm exec prisma migrate deploy --schema=services/storefront-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_pos \
  pnpm exec prisma migrate deploy --schema=services/pos-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_crm \
  pnpm exec prisma migrate deploy --schema=services/crm-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_dispatch \
  pnpm exec prisma migrate deploy --schema=services/dispatch-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_payment \
  pnpm exec prisma migrate deploy --schema=services/payment-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_ledger \
  pnpm exec prisma migrate deploy --schema=services/ledger-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_analytics \
  pnpm exec prisma migrate deploy --schema=services/analytics-service/src/prisma/schema.prisma

DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_notification \
  pnpm exec prisma migrate deploy --schema=services/notification-service/src/prisma/schema.prisma

echo "[5/6] Seeding demo tenant and admin user..."
DATABASE_URL=postgresql://cosmos:cosmos@localhost:5432/cosmos_auth pnpm seed

echo "[6/6] Generating service JWT keys..."
node scripts/generate-service-keys.mjs

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     BOOTSTRAP COMPLETE                   ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Admin email:    admin@cosmos.local      ║"
echo "║  Admin password: admin1234               ║"
echo "║  Web admin:      http://localhost:4000   ║"
echo "║  Gateway:        http://localhost:3000   ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Next: copy .env.example to .env, fill in Stripe + AWS keys, then run:"
echo "  pnpm dev"
echo ""
