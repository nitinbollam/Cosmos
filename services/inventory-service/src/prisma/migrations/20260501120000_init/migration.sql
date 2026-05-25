-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'FULFILLED', 'RELEASED', 'EXPIRED');

-- CreateTable
CREATE TABLE "StockLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "batchId" TEXT,
    "eventType" TEXT NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "quantityAfter" INTEGER NOT NULL,
    "unitCost" DECIMAL(10,4) NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "performedBy" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "batchId" TEXT,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "quantityReserved" INTEGER NOT NULL DEFAULT 0,
    "quantityAvailable" INTEGER NOT NULL DEFAULT 0,
    "reorderPoint" INTEGER NOT NULL DEFAULT 0,
    "reorderQty" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SKU" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "barcode" TEXT,
    "unitOfMeasure" TEXT NOT NULL DEFAULT 'EACH',
    "weightGrams" DECIMAL(10,3),
    "isTobacco" BOOLEAN NOT NULL DEFAULT false,
    "isRegulated" BOOLEAN NOT NULL DEFAULT false,
    "manufacturerId" TEXT,
    "manufacturerDid" TEXT,
    "exciseTaxCategory" TEXT,
    "cost" DECIMAL(10,4) NOT NULL,
    "price" DECIMAL(10,4) NOT NULL,
    "minPrice" DECIMAL(10,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SKU_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "batchId" TEXT,
    "orderId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockLedgerEntry_tenantId_skuId_warehouseId_idx" ON "StockLedgerEntry"("tenantId", "skuId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_tenantId_occurredAt_idx" ON "StockLedgerEntry"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_correlationId_idx" ON "StockLedgerEntry"("correlationId");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_batchId_idx" ON "StockLedgerEntry"("batchId");

-- CreateIndex
CREATE INDEX "StockLevel_tenantId_warehouseId_idx" ON "StockLevel"("tenantId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockLevel_tenantId_skuId_idx" ON "StockLevel"("tenantId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_tenantId_skuId_warehouseId_batchId_key" ON "StockLevel"("tenantId", "skuId", "warehouseId", "batchId");

-- CreateIndex
CREATE INDEX "SKU_tenantId_idx" ON "SKU"("tenantId");

-- CreateIndex
CREATE INDEX "SKU_tenantId_category_idx" ON "SKU"("tenantId", "category");

-- CreateIndex
CREATE INDEX "SKU_barcode_idx" ON "SKU"("barcode");

-- CreateIndex
CREATE INDEX "SKU_manufacturerDid_idx" ON "SKU"("manufacturerDid");

-- CreateIndex
CREATE UNIQUE INDEX "SKU_tenantId_code_key" ON "SKU"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Warehouse_tenantId_idx" ON "Warehouse"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_tenantId_code_key" ON "Warehouse"("tenantId", "code");

-- CreateIndex
CREATE INDEX "StockReservation_tenantId_orderId_idx" ON "StockReservation"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "StockReservation_tenantId_skuId_warehouseId_idx" ON "StockReservation"("tenantId", "skuId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockReservation_expiresAt_idx" ON "StockReservation"("expiresAt");

