-- 仓库流水线为增量能力：原应用/构建默认保留原模式，不重写历史镜像和部署记录。
ALTER TABLE "applications"
  ADD COLUMN "ci_execution_mode" TEXT NOT NULL DEFAULT 'COMPONENT_DOCKER',
  ADD COLUMN "pipeline_definition_path" TEXT,
  ADD COLUMN "pipeline_definition_json" JSONB,
  ADD COLUMN "pipeline_definition_sha256" TEXT,
  ADD COLUMN "pipeline_build_type_id" TEXT;
ALTER TABLE "builds"
  ADD COLUMN "publication_status" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN "definition_snapshot_json" JSONB,
  ADD COLUMN "artifact_manifest_json" JSONB;
-- 同一 TeamCity build 仍只有一条 Build；阶段按 build/code 幂等登记。
CREATE TABLE "build_stages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "build_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "build_stages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "build_stages_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "builds"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "build_stages_build_id_code_key" ON "build_stages"("build_id", "code");
