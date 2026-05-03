-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "NotificationRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationRequest_tenantId_idx" ON "NotificationRequest"("tenantId");
CREATE UNIQUE INDEX "NotificationRequest_tenantId_idempotencyKey_key" ON "NotificationRequest"("tenantId", "idempotencyKey");
