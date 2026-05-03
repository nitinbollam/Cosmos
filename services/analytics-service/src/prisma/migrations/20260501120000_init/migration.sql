CREATE TABLE "DailyKpiSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "ordersCount" INTEGER NOT NULL,
    "revenue" DECIMAL(18,4) NOT NULL,
    "skusActive" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DailyKpiSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyKpiSnapshot_tenantId_date_key" ON "DailyKpiSnapshot"("tenantId", "date");
CREATE INDEX "DailyKpiSnapshot_tenantId_idx" ON "DailyKpiSnapshot"("tenantId");
