CREATE TABLE "WebhookAttempt" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "beforeStatus" TEXT NOT NULL,
  "afterStatus" TEXT NOT NULL,
  "error" TEXT,
  "durationMs" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebhookAttempt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "WebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WebhookAttempt_eventId_createdAt_idx" ON "WebhookAttempt"("eventId", "createdAt");
