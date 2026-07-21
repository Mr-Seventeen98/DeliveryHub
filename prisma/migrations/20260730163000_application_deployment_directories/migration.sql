CREATE TABLE "application_deployment_directories" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_deployment_directories_pkey" PRIMARY KEY ("id")
);

INSERT INTO "application_deployment_directories" (
    "id",
    "application_id",
    "name",
    "path",
    "enabled",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    historical."application_id",
    min(old_directory."name"),
    old_directory."path",
    bool_or(old_directory."enabled"),
    min(old_directory."created_at"),
    max(old_directory."updated_at")
FROM "server_deployment_directories" old_directory
JOIN (
    SELECT DISTINCT
        deployment."deployment_directory_id",
        component."application_id"
    FROM "deployments" deployment
    JOIN "image_versions" image_version
      ON image_version."id" = deployment."image_version_id"
    JOIN "components" component
      ON component."id" = image_version."component_id"
) historical
  ON historical."deployment_directory_id" = old_directory."id"
GROUP BY historical."application_id", old_directory."path";

ALTER TABLE "deployments"
DROP CONSTRAINT "deployments_deployment_directory_id_fkey";

UPDATE "deployments" deployment
SET "deployment_directory_id" = project_directory."id"
FROM "image_versions" image_version,
     "components" component,
     "server_deployment_directories" old_directory,
     "application_deployment_directories" project_directory
WHERE image_version."id" = deployment."image_version_id"
  AND component."id" = image_version."component_id"
  AND old_directory."id" = deployment."deployment_directory_id"
  AND project_directory."application_id" = component."application_id"
  AND project_directory."path" = old_directory."path";

DROP TABLE "server_deployment_directories";

CREATE UNIQUE INDEX "application_deployment_directories_application_id_path_key"
ON "application_deployment_directories"("application_id", "path");
CREATE INDEX "application_deployment_directories_application_id_enabled_idx"
ON "application_deployment_directories"("application_id", "enabled");

ALTER TABLE "application_deployment_directories"
ADD CONSTRAINT "application_deployment_directories_application_id_fkey"
FOREIGN KEY ("application_id") REFERENCES "applications"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deployments"
ADD CONSTRAINT "deployments_deployment_directory_id_fkey"
FOREIGN KEY ("deployment_directory_id")
REFERENCES "application_deployment_directories"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
