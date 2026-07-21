CREATE TYPE "DeploymentStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

CREATE TABLE "deployments" (
    "id" UUID NOT NULL,
    "image_version_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "deployment_directory_id" UUID NOT NULL,
    "service_name" TEXT NOT NULL,
    "image_variable" TEXT NOT NULL DEFAULT 'DELIVERY_IMAGE',
    "image_full_name" TEXT NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'PENDING',
    "output" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deployments_status_created_at_idx"
ON "deployments"("status", "created_at");
CREATE INDEX "deployments_server_id_created_at_idx"
ON "deployments"("server_id", "created_at");
CREATE INDEX "deployments_image_version_id_idx"
ON "deployments"("image_version_id");

ALTER TABLE "deployments"
ADD CONSTRAINT "deployments_image_version_id_fkey"
FOREIGN KEY ("image_version_id") REFERENCES "image_versions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deployments"
ADD CONSTRAINT "deployments_server_id_fkey"
FOREIGN KEY ("server_id") REFERENCES "servers"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deployments"
ADD CONSTRAINT "deployments_deployment_directory_id_fkey"
FOREIGN KEY ("deployment_directory_id") REFERENCES "server_deployment_directories"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deployments"
ADD CONSTRAINT "deployments_created_by_fkey"
FOREIGN KEY ("created_by") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
