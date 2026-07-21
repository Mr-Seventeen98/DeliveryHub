ALTER TABLE "ci_provision_tasks"
ADD COLUMN "queue_job_id" TEXT;

CREATE UNIQUE INDEX "ci_provision_tasks_queue_job_id_key"
ON "ci_provision_tasks"("queue_job_id");
