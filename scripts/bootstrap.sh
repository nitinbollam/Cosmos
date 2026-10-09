#!/usr/bin/env bash
# Pleros first-time bootstrap (@pleros/web — Next.js only, local Postgres).
set -euo pipefail

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     PLEROS BOOTSTRAP — FIRST RUN         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

echo "[1/6] Installing dependencies..."
npm install

echo "[2/6] Preparing .env..."
test -f .env || cp .env.example .env

echo "[3/6] Preparing embedded SQLite (.data/)..."
npm run db:setup

echo "[4/6] Generating Prisma clients..."
npm run db:generate

echo "[5/6] Pushing database schemas..."
npm run db:migrate

echo "[6/6] Seeding demo tenant..."
npm run seed

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     BOOTSTRAP COMPLETE                   ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Email:    admin@pleros.local            ║"
echo "║  Password: admin1234                     ║"
echo "║  App:      http://localhost:4000         ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Run: npm run dev"
