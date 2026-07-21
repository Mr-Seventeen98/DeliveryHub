CREATE TYPE "DeploymentEnvironment" AS ENUM ('PRODUCTION', 'UAT', 'TEST');

ALTER TABLE "application_deployment_directories"
ADD COLUMN "environment" "DeploymentEnvironment" NOT NULL DEFAULT 'UAT';

DROP INDEX "application_deployment_directories_application_id_path_key";
DROP INDEX "application_deployment_directories_application_id_enabled_idx";

CREATE UNIQUE INDEX "application_deployment_directories_application_id_environment_path_key"
ON "application_deployment_directories"("application_id", "environment", "path");

CREATE INDEX "application_deployment_directories_application_id_environment_enabled_idx"
ON "application_deployment_directories"("application_id", "environment", "enabled");
