CREATE TABLE "teamcity_vcs_roots" (
    "id" UUID NOT NULL,
    "teamcity_connection_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teamcity_project_id" TEXT NOT NULL,
    "teamcity_project_name" TEXT NOT NULL,
    "repository_url" TEXT NOT NULL,
    "normalized_repository" TEXT NOT NULL,
    "gitlab_project_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teamcity_vcs_roots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "teamcity_vcs_roots_teamcity_connection_id_external_id_key"
ON "teamcity_vcs_roots"("teamcity_connection_id", "external_id");

CREATE INDEX "teamcity_vcs_roots_gitlab_project_id_active_idx"
ON "teamcity_vcs_roots"("gitlab_project_id", "active");

CREATE INDEX "teamcity_vcs_roots_normalized_repository_idx"
ON "teamcity_vcs_roots"("normalized_repository");

ALTER TABLE "teamcity_vcs_roots"
ADD CONSTRAINT "teamcity_vcs_roots_teamcity_connection_id_fkey"
FOREIGN KEY ("teamcity_connection_id") REFERENCES "teamcity_connections"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "teamcity_vcs_roots"
ADD CONSTRAINT "teamcity_vcs_roots_gitlab_project_id_fkey"
FOREIGN KEY ("gitlab_project_id") REFERENCES "gitlab_projects"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
