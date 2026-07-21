CREATE TYPE "ServerAuthType" AS ENUM ('SSH_KEY', 'PASSWORD');
CREATE TYPE "ServerStatus" AS ENUM ('PENDING', 'ONLINE', 'OFFLINE', 'ERROR', 'DISABLED');

CREATE TABLE "servers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "username" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "deploy_path" TEXT NOT NULL,
    "auth_type" "ServerAuthType" NOT NULL DEFAULT 'SSH_KEY',
    "credential_id" UUID NOT NULL,
    "public_key" TEXT,
    "key_fingerprint" TEXT,
    "host_key_fingerprint" TEXT,
    "status" "ServerStatus" NOT NULL DEFAULT 'PENDING',
    "last_test_at" TIMESTAMP(3),
    "last_test_message" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "servers_name_key" ON "servers"("name");
CREATE INDEX "servers_environment_status_idx" ON "servers"("environment", "status");
CREATE INDEX "servers_credential_id_idx" ON "servers"("credential_id");
CREATE INDEX "servers_host_port_idx" ON "servers"("host", "port");

ALTER TABLE "servers" ADD CONSTRAINT "servers_credential_id_fkey"
FOREIGN KEY ("credential_id") REFERENCES "credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "servers" ADD CONSTRAINT "servers_created_by_fkey"
FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
