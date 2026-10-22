/** 回调与 Registry 的受控替身验证登记事务边界；不冒充真实 TeamCity/TCR 联调。 */
import { describe, expect, it, vi } from "vitest";
import { RepositoryBuildsService } from "./repository-builds.service";
import { resultFixture } from "../provisioning/repository-pipeline.fixtures";

function scenario(status = "SUCCESS") {
  const { definition, sha256, result } = resultFixture();
  const application = {
    id: "application",
    pipelineBuildTypeId: "RepositoryCI",
    registryConnectionId: "registry",
    pipelineDefinitionJson: definition,
    pipelineDefinitionSha256: sha256,
    releaseBranch: "main",
  };
  const build = {
    id: "build",
    commitSha: result.commitSha,
    publicationStatus: "PENDING",
    definitionSnapshotJson: { definition, sha256 },
  };
  const tx = {
    build: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(build),
      update: vi.fn().mockResolvedValue(build),
    },
    buildStage: { upsert: vi.fn().mockResolvedValue({}) },
    imageVersion: { upsert: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    application: { findUnique: vi.fn().mockResolvedValue(application) },
    build: { upsert: vi.fn().mockResolvedValue(build) },
    registryConnection: {
      findUnique: vi.fn().mockResolvedValue({
        enabled: true,
        registryUrl: "https://registry.example.test",
        namespace: "ci",
        verifySsl: true,
      }),
    },
    component: {
      findMany: vi.fn().mockResolvedValue(
        definition.components.map((component) => ({
          id: component.code,
          code: component.code,
        })),
      ),
    },
    $transaction: vi.fn(async (action: (client: typeof tx) => unknown) =>
      action(tx),
    ),
  };
  const teamCity = {
    getBuildById: vi.fn().mockResolvedValue({
      id: 100,
      buildType: { id: "RepositoryCI" },
      state: "finished",
      status,
      revisions: { revision: [{ version: result.commitSha }] },
    }),
  };
  const registry = {
    getManifestDigest: vi.fn().mockResolvedValue("sha256:" + "b".repeat(64)),
  };
  const credentials = { resolve: vi.fn().mockResolvedValue("fixture-only") };
  const service = new RepositoryBuildsService(
    prisma as never,
    credentials as never,
    teamCity as never,
    registry as never,
  );
  return { service, result, tx, prisma, teamCity, registry };
}
const config = {
  baseUrl: "https://teamcity.example.test",
  token: "fixture",
  verifySsl: true,
};

describe("repository image registration", () => {
  it("第五个远端摘要失败时，不登记前四个可用镜像", async () => {
    const fixture = scenario();
    fixture.registry.getManifestDigest
      .mockResolvedValueOnce("sha256:" + "b".repeat(64))
      .mockResolvedValueOnce("sha256:" + "b".repeat(64))
      .mockResolvedValueOnce("sha256:" + "b".repeat(64))
      .mockResolvedValueOnce("sha256:" + "b".repeat(64))
      .mockResolvedValueOnce("sha256:" + "c".repeat(64));
    await expect(
      fixture.service.ingest("application", "100", fixture.result, config),
    ).rejects.toThrow("摘要不匹配");
    expect(fixture.tx.imageVersion.upsert).not.toHaveBeenCalled();
    expect(fixture.tx.build.update).not.toHaveBeenCalled();
  });
  it("全部摘要一致后才登记五个镜像，并标记整套可用", async () => {
    const fixture = scenario();
    expect(
      (
        await fixture.service.ingest(
          "application",
          "100",
          fixture.result,
          config,
        )
      ).images,
    ).toBe(5);
    expect(fixture.tx.imageVersion.upsert).toHaveBeenCalledTimes(5);
    expect(fixture.tx.build.update).toHaveBeenCalledWith({
      where: { id: "build" },
      data: { publicationStatus: "VERIFIED" },
    });
  });
  it("TC 实际失败或仍运行时，伪造成功清单不能登记镜像", async () => {
    const fixture = scenario("FAILURE");
    expect(
      (
        await fixture.service.ingest(
          "application",
          "100",
          fixture.result,
          config,
        )
      ).images,
    ).toBe(0);
    expect(fixture.registry.getManifestDigest).not.toHaveBeenCalled();
    expect(fixture.tx.imageVersion.upsert).not.toHaveBeenCalled();
  });
  it("拒绝其他 Build Configuration 的回调", async () => {
    const fixture = scenario();
    fixture.teamCity.getBuildById.mockResolvedValue({
      id: 100,
      buildType: { id: "Foreign" },
    } as never);
    await expect(
      fixture.service.ingest("application", "100", fixture.result, config),
    ).rejects.toThrow("不属于");
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("迟到的 PARTIAL 不能把并发完成的 VERIFIED 版本降级", async () => {
    const fixture = scenario();
    fixture.tx.build.updateMany.mockResolvedValue({ count: 0 });
    const result = await fixture.service.ingest(
      "application",
      "100",
      { ...fixture.result, publicationStatus: "PARTIAL" },
      config,
    );
    expect(result.images).toBe(0);
    expect(fixture.tx.buildStage.upsert).not.toHaveBeenCalled();
    expect(fixture.registry.getManifestDigest).not.toHaveBeenCalled();
  });
});
