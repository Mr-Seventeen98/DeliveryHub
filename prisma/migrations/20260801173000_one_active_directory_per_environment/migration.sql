WITH ranked_directories AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "application_id", "environment"
      ORDER BY "updated_at" DESC, "created_at" DESC
    ) AS position
  FROM "application_deployment_directories"
  WHERE "enabled" = true
)
UPDATE "application_deployment_directories" directory
SET "enabled" = false
FROM ranked_directories ranked
WHERE directory."id" = ranked."id"
  AND ranked.position > 1;

CREATE UNIQUE INDEX "application_deployment_directories_one_active_environment_key"
ON "application_deployment_directories"("application_id", "environment")
WHERE "enabled" = true;
