ALTER TABLE "servers"
ADD COLUMN "ssh_alias" TEXT;

ALTER TABLE "servers"
ALTER COLUMN "host" DROP NOT NULL,
ALTER COLUMN "username" DROP NOT NULL,
ALTER COLUMN "credential_id" DROP NOT NULL;

CREATE UNIQUE INDEX "servers_ssh_alias_key"
ON "servers"("ssh_alias");
