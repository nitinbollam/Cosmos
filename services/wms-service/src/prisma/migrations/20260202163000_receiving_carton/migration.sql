-- CreateEnum
CREATE TYPE "ReceivingStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'DISCREPANCY', 'CLOSED');

-- CreateTable
CREATE TABLE "ReceivingSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "poId" TEXT,
    "asnId" TEXT,
    "status" "ReceivingStatus" NOT NULL DEFAULT 'OPEN',
    "startedBy" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "discrepancyNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceivingSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReceivingSession_tenantId_warehouseId_status_idx" ON "ReceivingSession"("tenantId", "warehouseId", "status");
CREATE INDEX "ReceivingSession_tenantId_poId_idx" ON "ReceivingSession"("tenantId", "poId");
CREATE INDEX "ReceivingSession_tenantId_idx" ON "ReceivingSession"("tenantId");

-- CreateTable
CREATE TABLE "ReceivingItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT,
    "barcode" TEXT,
    "expectedQty" INTEGER,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "batchId" TEXT,
    "expiryDate" TIMESTAMP(3),
    "locationId" TEXT,
    "scannedBy" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceivingItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReceivingItem_sessionId_idx" ON "ReceivingItem"("sessionId");
CREATE INDEX "ReceivingItem_barcode_idx" ON "ReceivingItem"("barcode");
CREATE INDEX "ReceivingItem_skuId_idx" ON "ReceivingItem"("skuId");
CREATE INDEX "ReceivingItem_purchaseOrderLineId_idx" ON "ReceivingItem"("purchaseOrderLineId");

ALTER TABLE "ReceivingItem" ADD CONSTRAINT "ReceivingItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ReceivingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Carton" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "cartonNumber" INTEGER NOT NULL,
    "weightGrams" INTEGER,
    "lengthCm" INTEGER,
    "widthCm" INTEGER,
    "heightCm" INTEGER,
    "trackingNum" TEXT,
    "carrier" TEXT,
    "labelUrl" TEXT,
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Carton_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Carton_tenantId_taskId_idx" ON "Carton"("tenantId", "taskId");
CREATE INDEX "Carton_taskId_idx" ON "Carton"("taskId");
CREATE INDEX "Carton_tenantId_idx" ON "Carton"("tenantId");

ALTER TABLE "Carton" ADD CONSTRAINT "Carton_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "FulfillmentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CartonItem" (
    "id" TEXT NOT NULL,
    "cartonId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "CartonItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CartonItem_cartonId_idx" ON "CartonItem"("cartonId");
CREATE INDEX "CartonItem_skuId_idx" ON "CartonItem"("skuId");

ALTER TABLE "CartonItem" ADD CONSTRAINT "CartonItem_cartonId_fkey" FOREIGN KEY ("cartonId") REFERENCES "Carton"("id") ON DELETE CASCADE ON UPDATE CASCADE;
