-- CreateEnum
CREATE TYPE "FulfillmentTaskStatus" AS ENUM ('PENDING', 'PICKING', 'PACKED', 'DISPATCHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PickLineStatus" AS ENUM ('PENDING', 'PICKED', 'SHORT');

-- CreateTable
CREATE TABLE "FulfillmentTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "FulfillmentTaskStatus" NOT NULL DEFAULT 'PENDING',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "correlationId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfillmentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickLine" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "pickedQty" INTEGER NOT NULL DEFAULT 0,
    "status" "PickLineStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "PickLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentTask_tenantId_orderId_key" ON "FulfillmentTask"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "FulfillmentTask_tenantId_status_idx" ON "FulfillmentTask"("tenantId", "status");

-- CreateIndex
CREATE INDEX "FulfillmentTask_tenantId_updatedAt_idx" ON "FulfillmentTask"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "PickLine_taskId_idx" ON "PickLine"("taskId");

-- AddForeignKey
ALTER TABLE "PickLine" ADD CONSTRAINT "PickLine_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "FulfillmentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
