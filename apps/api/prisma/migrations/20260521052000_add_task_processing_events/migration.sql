-- CreateTable
CREATE TABLE "TaskProcessingEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "operatorId" TEXT,
    "electronicSignature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskProcessingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskProcessingEvent_taskId_createdAt_idx" ON "TaskProcessingEvent"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskProcessingEvent_patientId_createdAt_idx" ON "TaskProcessingEvent"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskProcessingEvent_eventType_createdAt_idx" ON "TaskProcessingEvent"("eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "TaskProcessingEvent" ADD CONSTRAINT "TaskProcessingEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskProcessingEvent" ADD CONSTRAINT "TaskProcessingEvent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
