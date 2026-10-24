-- 只扩展发布记录与策略，不修改历史部署状态；验收账号/密码不落入业务库。
ALTER TABLE "application_deployment_directories" ADD COLUMN "acceptance_build_type_id" TEXT;
ALTER TABLE "repository_deployments"
  ADD COLUMN "acceptance_status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN "acceptance_build_type_id" TEXT,
  ADD COLUMN "acceptance_teamcity_build_id" TEXT,
  ADD COLUMN "acceptance_result_json" JSONB,
  ADD COLUMN "acceptance_error_message" TEXT,
  ADD COLUMN "acceptance_started_at" TIMESTAMP(3),
  ADD COLUMN "acceptance_finished_at" TIMESTAMP(3),
  ADD COLUMN "acceptance_lease_token" TEXT,
  ADD COLUMN "acceptance_lease_until" TIMESTAMP(3);
CREATE INDEX "repository_deployments_acceptance_status_idx" ON "repository_deployments"("acceptance_status");
