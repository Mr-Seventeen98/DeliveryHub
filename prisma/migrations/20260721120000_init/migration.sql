-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('GITLAB_TOKEN', 'TEAMCITY_TOKEN', 'REGISTRY_USERNAME', 'REGISTRY_PASSWORD', 'SSH_PASSWORD', 'SSH_PRIVATE_KEY');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('ACTIVE', 'MISSING', 'INACCESSIBLE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('NOT_IMPORTED', 'IMPORTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "BuildMode" AS ENUM ('BUILD_ALL', 'PATH_BASED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('CONFIGURING', 'ACTIVE', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "RegistryType" AS ENUM ('TENCENT_TCR', 'GENERIC');

-- CreateEnum
CREATE TYPE "ProvisionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL_FAILED', 'FAILED', 'ROLLING_BACK', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "ProvisionStepStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TeamCityResourceType" AS ENUM ('PROJECT', 'VCS_ROOT', 'BUILD_TYPE', 'TRIGGER', 'PARAMETER');

-- CreateEnum
CREATE TYPE "ExternalResourceStatus" AS ENUM ('ACTIVE', 'MISSING', 'DRIFTED', 'ERROR');

-- CreateEnum
CREATE TYPE "BuildStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('VCS', 'MANUAL', 'API');

-- CreateEnum
CREATE TYPE "ImageStatus" AS ENUM ('AVAILABLE', 'DEPRECATED', 'DELETED');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CredentialType" NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "masked_hint" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gitlab_instances" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_url" TEXT NOT NULL,
    "token_credential_id" UUID NOT NULL,
    "verify_ssl" BOOLEAN NOT NULL DEFAULT true,
    "sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sync_interval_minutes" INTEGER NOT NULL DEFAULT 30,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_status" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gitlab_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gitlab_projects" (
    "id" UUID NOT NULL,
    "gitlab_instance_id" UUID NOT NULL,
    "gitlab_project_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "path_with_namespace" TEXT NOT NULL,
    "namespace_name" TEXT NOT NULL,
    "web_url" TEXT NOT NULL,
    "http_clone_url" TEXT NOT NULL,
    "ssh_clone_url" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "description" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "last_activity_at" TIMESTAMP(3),
    "sync_status" "SyncStatus" NOT NULL DEFAULT 'ACTIVE',
    "import_status" "ImportStatus" NOT NULL DEFAULT 'NOT_IMPORTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gitlab_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teamcity_connections" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "token_credential_id" UUID NOT NULL,
    "parent_project_id" TEXT NOT NULL,
    "verify_ssl" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_test_at" TIMESTAMP(3),
    "last_test_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teamcity_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registry_connections" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "registry_type" "RegistryType" NOT NULL,
    "registry_url" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "username_credential_id" UUID NOT NULL,
    "password_credential_id" UUID NOT NULL,
    "verify_ssl" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_test_at" TIMESTAMP(3),
    "last_test_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registry_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "gitlab_project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "release_branch" TEXT NOT NULL,
    "build_mode" "BuildMode" NOT NULL DEFAULT 'BUILD_ALL',
    "auto_build_enabled" BOOLEAN NOT NULL DEFAULT true,
    "teamcity_connection_id" UUID NOT NULL,
    "teamcity_project_id" TEXT,
    "registry_connection_id" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'CONFIGURING',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "components" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "source_directory" TEXT NOT NULL,
    "dockerfile_path" TEXT NOT NULL,
    "build_context" TEXT NOT NULL,
    "build_args_json" JSONB NOT NULL DEFAULT '{}',
    "image_repository" TEXT NOT NULL,
    "path_trigger_enabled" BOOLEAN NOT NULL DEFAULT false,
    "path_include_rules_json" JSONB NOT NULL DEFAULT '[]',
    "path_shared_rules_json" JSONB NOT NULL DEFAULT '[]',
    "teamcity_build_type_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ci_provision_tasks" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "status" "ProvisionStatus" NOT NULL DEFAULT 'PENDING',
    "current_step" TEXT,
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "request_snapshot_json" JSONB NOT NULL DEFAULT '{}',
    "result_json" JSONB NOT NULL DEFAULT '{}',
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ci_provision_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ci_provision_steps" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "step_code" TEXT NOT NULL,
    "step_name" TEXT NOT NULL,
    "status" "ProvisionStepStatus" NOT NULL DEFAULT 'PENDING',
    "external_resource_id" TEXT,
    "request_summary_json" JSONB NOT NULL DEFAULT '{}',
    "response_summary_json" JSONB NOT NULL DEFAULT '{}',
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "ci_provision_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teamcity_resources" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "component_id" UUID,
    "resource_type" "TeamCityResourceType" NOT NULL,
    "resource_external_id" TEXT NOT NULL,
    "resource_name" TEXT NOT NULL,
    "managed_by_platform" BOOLEAN NOT NULL DEFAULT true,
    "last_verified_at" TIMESTAMP(3),
    "status" "ExternalResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teamcity_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "builds" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "component_id" UUID,
    "teamcity_build_id" TEXT NOT NULL,
    "teamcity_build_number" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "commit_message" TEXT,
    "status" "BuildStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger_type" "TriggerType" NOT NULL,
    "triggered_by" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "log_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "builds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_versions" (
    "id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "build_id" UUID NOT NULL,
    "registry" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "digest" TEXT,
    "full_name" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "build_number" TEXT NOT NULL,
    "status" "ImageStatus" NOT NULL DEFAULT 'AVAILABLE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "request_id" TEXT NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "result" "AuditResult" NOT NULL,
    "error_message" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "credentials_created_by_idx" ON "credentials"("created_by");

-- CreateIndex
CREATE INDEX "gitlab_instances_token_credential_id_idx" ON "gitlab_instances"("token_credential_id");

-- CreateIndex
CREATE INDEX "gitlab_projects_path_with_namespace_idx" ON "gitlab_projects"("path_with_namespace");

-- CreateIndex
CREATE UNIQUE INDEX "gitlab_projects_gitlab_instance_id_gitlab_project_id_key" ON "gitlab_projects"("gitlab_instance_id", "gitlab_project_id");

-- CreateIndex
CREATE INDEX "teamcity_connections_token_credential_id_idx" ON "teamcity_connections"("token_credential_id");

-- CreateIndex
CREATE INDEX "registry_connections_username_credential_id_idx" ON "registry_connections"("username_credential_id");

-- CreateIndex
CREATE INDEX "registry_connections_password_credential_id_idx" ON "registry_connections"("password_credential_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_code_key" ON "applications"("code");

-- CreateIndex
CREATE INDEX "applications_gitlab_project_id_idx" ON "applications"("gitlab_project_id");

-- CreateIndex
CREATE UNIQUE INDEX "components_application_id_code_key" ON "components"("application_id", "code");

-- CreateIndex
CREATE INDEX "ci_provision_tasks_application_id_status_idx" ON "ci_provision_tasks"("application_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ci_provision_steps_task_id_step_code_key" ON "ci_provision_steps"("task_id", "step_code");

-- CreateIndex
CREATE UNIQUE INDEX "teamcity_resources_application_id_resource_type_resource_ex_key" ON "teamcity_resources"("application_id", "resource_type", "resource_external_id");

-- CreateIndex
CREATE INDEX "builds_application_id_created_at_idx" ON "builds"("application_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "builds_teamcity_build_id_key" ON "builds"("teamcity_build_id");

-- CreateIndex
CREATE INDEX "image_versions_build_id_idx" ON "image_versions"("build_id");

-- CreateIndex
CREATE UNIQUE INDEX "image_versions_component_id_full_name_key" ON "image_versions"("component_id", "full_name");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gitlab_instances" ADD CONSTRAINT "gitlab_instances_token_credential_id_fkey" FOREIGN KEY ("token_credential_id") REFERENCES "credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gitlab_projects" ADD CONSTRAINT "gitlab_projects_gitlab_instance_id_fkey" FOREIGN KEY ("gitlab_instance_id") REFERENCES "gitlab_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teamcity_connections" ADD CONSTRAINT "teamcity_connections_token_credential_id_fkey" FOREIGN KEY ("token_credential_id") REFERENCES "credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registry_connections" ADD CONSTRAINT "registry_connections_username_credential_id_fkey" FOREIGN KEY ("username_credential_id") REFERENCES "credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registry_connections" ADD CONSTRAINT "registry_connections_password_credential_id_fkey" FOREIGN KEY ("password_credential_id") REFERENCES "credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_gitlab_project_id_fkey" FOREIGN KEY ("gitlab_project_id") REFERENCES "gitlab_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_teamcity_connection_id_fkey" FOREIGN KEY ("teamcity_connection_id") REFERENCES "teamcity_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_registry_connection_id_fkey" FOREIGN KEY ("registry_connection_id") REFERENCES "registry_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "components" ADD CONSTRAINT "components_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ci_provision_tasks" ADD CONSTRAINT "ci_provision_tasks_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ci_provision_tasks" ADD CONSTRAINT "ci_provision_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ci_provision_steps" ADD CONSTRAINT "ci_provision_steps_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "ci_provision_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teamcity_resources" ADD CONSTRAINT "teamcity_resources_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teamcity_resources" ADD CONSTRAINT "teamcity_resources_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builds" ADD CONSTRAINT "builds_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builds" ADD CONSTRAINT "builds_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "components"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_versions" ADD CONSTRAINT "image_versions_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_versions" ADD CONSTRAINT "image_versions_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
