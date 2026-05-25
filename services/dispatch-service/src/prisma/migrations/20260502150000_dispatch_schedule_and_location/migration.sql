-- AlterTable
ALTER TABLE "DeliveryRoute" ADD COLUMN     "scheduledFor" TIMESTAMP(3),
ADD COLUMN "lastKnownLat" DOUBLE PRECISION,
ADD COLUMN "lastKnownLng" DOUBLE PRECISION,
ADD COLUMN "lastKnownAt" TIMESTAMP(3);

CREATE INDEX "DeliveryRoute_tenantId_scheduledFor_idx" ON "DeliveryRoute"("tenantId", "scheduledFor");
