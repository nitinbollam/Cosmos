-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StopStatus" AS ENUM ('PENDING', 'EN_ROUTE', 'DELIVERED', 'FAILED');

CREATE TABLE "DeliveryRoute" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "driverId" TEXT,
    "status" "RouteStatus" NOT NULL DEFAULT 'PLANNED',
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeliveryRoute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliveryRoute_tenantId_idx" ON "DeliveryRoute"("tenantId");
CREATE INDEX "DeliveryRoute_tenantId_status_idx" ON "DeliveryRoute"("tenantId", "status");

CREATE TABLE "RouteStop" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "address" JSONB NOT NULL,
    "status" "StopStatus" NOT NULL DEFAULT 'PENDING',
    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RouteStop_routeId_sequence_key" ON "RouteStop"("routeId", "sequence");
CREATE INDEX "RouteStop_routeId_idx" ON "RouteStop"("routeId");

ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "DeliveryRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
