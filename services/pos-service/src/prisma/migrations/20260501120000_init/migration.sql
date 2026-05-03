CREATE TABLE "PosRegister" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "PosRegister_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosRegister_tenantId_code_key" ON "PosRegister"("tenantId", "code");
CREATE INDEX "PosRegister_tenantId_idx" ON "PosRegister"("tenantId");

CREATE TABLE "PosShift" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingCash" DECIMAL(12,2) NOT NULL,
    "closingCash" DECIMAL(12,2),
    "openedBy" TEXT NOT NULL,
    "closedBy" TEXT,
    CONSTRAINT "PosShift_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PosShift_tenantId_idx" ON "PosShift"("tenantId");
CREATE INDEX "PosShift_registerId_idx" ON "PosShift"("registerId");

CREATE TABLE "PosSale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "saleRef" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PosSale_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PosSale_tenantId_idx" ON "PosSale"("tenantId");
CREATE INDEX "PosSale_shiftId_idx" ON "PosSale"("shiftId");

ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_registerId_fkey"
  FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
