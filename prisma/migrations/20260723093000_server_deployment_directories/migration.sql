CREATE TABLE "server_deployment_directories" (
    "id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "server_deployment_directories_pkey" PRIMARY KEY ("id")
);

INSERT INTO "server_deployment_directories" (
    "id", "server_id", "name", "path", "updated_at"
)
SELECT
    gen_random_uuid(), "id", '默认部署目录', "deploy_path", CURRENT_TIMESTAMP
FROM "servers"
WHERE "deploy_path" IS NOT NULL AND btrim("deploy_path") <> '';

CREATE UNIQUE INDEX "server_deployment_directories_server_id_name_key"
ON "server_deployment_directories"("server_id", "name");
CREATE UNIQUE INDEX "server_deployment_directories_server_id_path_key"
ON "server_deployment_directories"("server_id", "path");
CREATE INDEX "server_deployment_directories_server_id_enabled_idx"
ON "server_deployment_directories"("server_id", "enabled");

ALTER TABLE "server_deployment_directories"
ADD CONSTRAINT "server_deployment_directories_server_id_fkey"
FOREIGN KEY ("server_id") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "servers" DROP COLUMN "deploy_path";
