-- AlterTable
ALTER TABLE "FulfillmentTask" ADD COLUMN IF NOT EXISTS "assignedUserId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FulfillmentTask_tenantId_assignedUserId_idx" ON "FulfillmentTask"("tenantId", "assignedUserId");

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CycleCountType" AS ENUM ('FULL', 'ABC', 'RANDOM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CycleCountStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'PENDING_APPROVAL', 'COMPLETED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "CycleCount" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "type" "CycleCountType" NOT NULL,
  "status" "CycleCountStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduledFor" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CycleCount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CycleCountLine" (
  "id" TEXT NOT NULL,
  "countId" TEXT NOT NULL,
  "skuId" TEXT NOT NULL,
  "locationLabel" TEXT,
  "systemQty" INTEGER NOT NULL,
  "countedQty" INTEGER,
  CONSTRAINT "CycleCountLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CycleCount_tenantId_warehouseId_status_idx" ON "CycleCount"("tenantId", "warehouseId", "status");
CREATE INDEX IF NOT EXISTS "CycleCount_tenantId_createdAt_idx" ON "CycleCount"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "CycleCountLine_countId_idx" ON "CycleCountLine"("countId");
CREATE INDEX IF NOT EXISTS "CycleCountLine_skuId_idx" ON "CycleCountLine"("skuId");

DO $$ BEGIN
  ALTER TABLE "CycleCountLine" ADD CONSTRAINT "CycleCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "CycleCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
