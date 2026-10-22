/** 仅供边界测试的合成配置/制品，不包含真实连接或推送证据。 */
import { parsePipelineDefinition } from "./repository-pipeline";
import { repositoryResultSchema } from "../builds/repository-result";
export const definitionFixture = {
  version: 1,
  mode: "repository-pipeline",
  platform: "linux/amd64",
  entrypoint: "scripts/ci/pipeline.py",
  assetsLock: "deploy/ci/assets.lock.json",
  buildEnv: "deploy/visualization.uat.build.env",
  requiredReports: ["backend", "web"],
  components: ["api", "worker", "migration", "web", "visualization"].map(
    (code) => ({
      code,
      name: code,
      dockerfile: `deploy/${code}.Dockerfile`,
      context: `contexts/${code}`,
      imageRepository: `integrated-${code}`,
    }),
  ),
};
export function resultFixture() {
  const { definition, sha256 } = parsePipelineDefinition(
    JSON.stringify(definitionFixture),
  );
  return {
    definition,
    sha256,
    result: repositoryResultSchema.parse({
      version: 1,
      definitionSha256: sha256,
      commitSha: "a".repeat(40),
      platform: "linux/amd64",
      tag: "git-aaaaaaaaaaaa-b100",
      executionStatus: "SUCCESS",
      publicationStatus: "VERIFIED",
      stages: ["prepare", "test", "build", "verify", "push"].map((code) => ({
        code,
        status: "SUCCESS",
      })),
      reports: Object.fromEntries(
        ["backend", "web"].map((name) => [
          name,
          { passed: 1, failed: 0, skipped: 0, mandatorySkipped: 0 },
        ]),
      ),
      images: definition.components.map((component) => ({
        componentCode: component.code,
        repository: component.imageRepository,
        tag: "git-aaaaaaaaaaaa-b100",
        platform: "linux/amd64",
        digest: "sha256:" + "b".repeat(64),
        verified: true,
      })),
    }),
  };
}
