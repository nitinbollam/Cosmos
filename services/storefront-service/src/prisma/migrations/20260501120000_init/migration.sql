-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('OPEN', 'SUBMITTED', 'EXPIRED');

CREATE TABLE "B2BQuote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerRef" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "B2BQuote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "B2BQuote_tenantId_status_idx" ON "B2BQuote"("tenantId", "status");

CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "skuCode" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,4) NOT NULL,
    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuoteLine_quoteId_lineNo_key" ON "QuoteLine"("quoteId", "lineNo");
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");

ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "B2BQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
