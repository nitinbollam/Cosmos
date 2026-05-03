-- AlterTable
ALTER TABLE "B2BQuote" ADD COLUMN "convertedOrderId" TEXT;

-- CreateIndex
CREATE INDEX "B2BQuote_convertedOrderId_idx" ON "B2BQuote"("convertedOrderId");
