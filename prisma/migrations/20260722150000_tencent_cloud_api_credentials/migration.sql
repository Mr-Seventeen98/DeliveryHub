ALTER TYPE "CredentialType" ADD VALUE 'TENCENT_CLOUD_SECRET_ID';
ALTER TYPE "CredentialType" ADD VALUE 'TENCENT_CLOUD_SECRET_KEY';

ALTER TABLE "registry_connections"
  ADD COLUMN "cloud_secret_id_credential_id" UUID,
  ADD COLUMN "cloud_secret_key_credential_id" UUID;

CREATE INDEX "registry_connections_cloud_secret_id_credential_id_idx"
  ON "registry_connections"("cloud_secret_id_credential_id");
CREATE INDEX "registry_connections_cloud_secret_key_credential_id_idx"
  ON "registry_connections"("cloud_secret_key_credential_id");

ALTER TABLE "registry_connections"
  ADD CONSTRAINT "registry_connections_cloud_secret_id_credential_id_fkey"
  FOREIGN KEY ("cloud_secret_id_credential_id") REFERENCES "credentials"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "registry_connections"
  ADD CONSTRAINT "registry_connections_cloud_secret_key_credential_id_fkey"
  FOREIGN KEY ("cloud_secret_key_credential_id") REFERENCES "credentials"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
