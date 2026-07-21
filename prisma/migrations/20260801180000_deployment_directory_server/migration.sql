ALTER TABLE "application_deployment_directories"
ADD COLUMN "server_id" UUID;

ALTER TABLE "application_deployment_directories"
ADD CONSTRAINT "application_deployment_directories_server_id_fkey"
FOREIGN KEY ("server_id") REFERENCES "servers"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "application_deployment_directories_server_id_idx"
ON "application_deployment_directories"("server_id");
