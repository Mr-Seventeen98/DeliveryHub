-- 仅新增策略、租约和整套发布记录；旧手动部署表及记录保留。
ALTER TABLE "application_deployment_directories"
ADD COLUMN "auto_deploy_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "auto_deploy_branch" TEXT NOT NULL DEFAULT 'main',
ADD COLUMN "auto_deploy_runner_path" TEXT,
ADD COLUMN "auto_deploy_enabled_at" TIMESTAMP(3),
ADD COLUMN "deploy_lease_token" TEXT,
ADD COLUMN "deploy_lease_until" TIMESTAMP(3);
CREATE TABLE "repository_deployments" (
 "id" UUID NOT NULL, "build_id" UUID NOT NULL, "deployment_directory_id" UUID NOT NULL,
 "status" "DeploymentStatus" NOT NULL DEFAULT 'PENDING', "manifest_json" JSONB NOT NULL,
 "output" TEXT, "error_message" TEXT, "started_at" TIMESTAMP(3), "finished_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "repository_deployments_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "repository_deployments_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "builds"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "repository_deployments_deployment_directory_id_fkey" FOREIGN KEY ("deployment_directory_id") REFERENCES "application_deployment_directories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "repository_deployments_deployment_directory_id_build_id_key" ON "repository_deployments"("deployment_directory_id", "build_id");
CREATE INDEX "repository_deployments_status_created_at_idx" ON "repository_deployments"("status", "created_at");
