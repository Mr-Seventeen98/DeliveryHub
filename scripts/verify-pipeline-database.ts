/** 本地真实 PostgreSQL 验证：只接受专用回环测试库，验证增量兼容和五镜像事务，不连接 TC/TCR。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

async function main() {
  const url = new URL(process.env.CI_DATABASE_URL ?? "");
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.pathname.startsWith("/deliveryhub_ci_")
  )
    throw new Error("仅允许 deliveryhub_ci_* 回环隔离库");
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  const token = randomUUID();
  try {
    // 事务结束后统一回滚夹具，实际 SQL/约束执行过，但不留下可登录账号或业务构建。
    await db
      .$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            username: `ci-${token}`,
            passwordHash: "fixture-not-a-login-hash",
          },
        });
        const credential = await tx.credential.create({
          data: {
            name: "CI fixture",
            type: "GITLAB_TOKEN",
            ciphertext: "fixture",
            maskedHint: "fixture",
            createdById: user.id,
          },
        });
        const gitlab = await tx.gitLabInstance.create({
          data: {
            name: "fixture",
            baseUrl: "https://gitlab.example.test",
            apiUrl: "https://gitlab.example.test/api/v4",
            tokenCredentialId: credential.id,
          },
        });
        const project = await tx.gitLabProject.create({
          data: {
            gitLabInstanceId: gitlab.id,
            gitLabProjectId: 1,
            name: "fixture",
            path: "fixture",
            pathWithNamespace: "ci/fixture",
            namespaceName: "ci",
            webUrl: "https://gitlab.example.test/ci/fixture",
            httpCloneUrl: "https://gitlab.example.test/ci/fixture.git",
            sshCloneUrl: "git@gitlab.example.test:ci/fixture.git",
            defaultBranch: "main",
            visibility: "private",
          },
        });
        const tc = await tx.teamCityConnection.create({
          data: {
            name: "fixture",
            baseUrl: "https://tc.example.test",
            tokenCredentialId: credential.id,
            parentProjectId: "CI",
          },
        });
        const application = await tx.application.create({
          data: {
            gitLabProjectId: project.id,
            name: "fixture",
            code: `ci-${token}`,
            releaseBranch: "main",
            teamCityConnectionId: tc.id,
            createdById: user.id,
          },
        });
        assert.equal(application.ciExecutionMode, "COMPONENT_DOCKER");
        const build = await tx.build.create({
          data: {
            applicationId: application.id,
            teamCityBuildId: token,
            teamCityBuildNumber: "1",
            branch: "main",
            commitSha: "a".repeat(40),
            triggerType: "API",
          },
        });
        assert.equal(build.publicationStatus, "NOT_APPLICABLE");
        await tx.build.update({
          where: { id: build.id },
          data: {
            definitionSnapshotJson: { version: 1 },
            publicationStatus: "PENDING_VERIFY",
          },
        });
        await tx.buildStage.create({
          data: { buildId: build.id, code: "test", status: "SUCCESS" },
        });
        for (const code of [
          "api",
          "worker",
          "migration",
          "web",
          "visualization",
        ]) {
          const component = await tx.component.create({
            data: {
              applicationId: application.id,
              code,
              name: code,
              sourceDirectory: ".",
              dockerfilePath: `deploy/${code}.Dockerfile`,
              buildContext: ".",
              imageRepository: `fixture-${code}`,
            },
          });
          await tx.imageVersion.create({
            data: {
              componentId: component.id,
              buildId: build.id,
              registry: "registry.example.test",
              namespace: "ci",
              repository: code,
              tag: "fixture",
              fullName: `registry.example.test/ci/${code}:fixture-${token}`,
              commitSha: build.commitSha,
              buildNumber: "1",
            },
          });
        }
        assert.equal(
          await tx.imageVersion.count({ where: { buildId: build.id } }),
          5,
        );
        assert.equal(
          await tx.build.count({ where: { teamCityBuildId: token } }),
          1,
        );
        // 强制失败验证真实事务回滚：不会留下“前四个已登记”的半套记录。
        throw new Error("EXPECTED_FIXTURE_ROLLBACK");
      })
      .catch((error: Error) => {
        if (error.message !== "EXPECTED_FIXTURE_ROLLBACK") throw error;
      });
    assert.equal(
      await db.build.count({ where: { teamCityBuildId: token } }),
      0,
    );
    assert.equal(
      await db.user.count({ where: { username: `ci-${token}` } }),
      0,
    );
    console.log(
      "真实 PostgreSQL：旧默认值、单构建五镜像、阶段 FK 和事务回滚通过。",
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
