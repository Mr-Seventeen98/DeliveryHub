/** 保护真实环境调度边界：失败部署不入队，丢失响应查回，报告与 TC 终态/源码同时核验。 */
import { describe, expect, it, vi } from "vitest";
import {
  acceptanceToken,
  UatAcceptanceService,
  validateAcceptanceResult,
} from "./uat-acceptance.service";
import type { PrismaService } from "../../database/prisma.service";
import type { CredentialsService } from "../credentials/credentials.service";
import type { TeamCityClient } from "../../adapters/teamcity/teamcity.client";
import type { ConfigService } from "@nestjs/config";

const expected = {
  releaseId: "release",
  sourceBuildId: "3818",
  commitSha: "a".repeat(40),
  teamCityBuildId: "3819",
};
const report = () => ({
  schemaVersion: 1,
  ...expected,
  status: "SUCCESS",
  checks: [
    "release_identity_before",
    "login",
    "authorized_projects",
    "project_switch",
    "tenant_overview",
    "management_link",
    "map_runtime",
    "release_identity_after",
  ].map((name) => ({ name, status: "SUCCESS" })),
});

/** 模拟可信 TeamCity 与持久化发布，不模拟浏览器成功；此处验证的是编排/幂等/报告准入契约。 */
function fixture(overrides: Record<string, unknown> = {}) {
  const release = {
    id: "release",
    status: "SUCCESS",
    acceptanceStatus: "PENDING",
    acceptanceBuildTypeId: "UAT",
    acceptanceTeamCityBuildId: null,
    acceptanceStartedAt: null,
    build: {
      branch: "main",
      commitSha: expected.commitSha,
      teamCityBuildId: expected.sourceBuildId,
    },
    deploymentDirectory: {
      application: {
        teamCityConnection: {
          baseUrl: "http://tc",
          tokenCredentialId: "credential",
          verifySsl: true,
        },
      },
    },
    ...overrides,
  };
  const prisma = {
    repositoryDeployment: {
      findMany: vi.fn().mockResolvedValue([{ id: "release" }]),
      findUniqueOrThrow: vi.fn().mockResolvedValue(release),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const tc = {
    findAcceptanceBuild: vi.fn().mockResolvedValue(null),
    queueAcceptanceBuild: vi.fn().mockResolvedValue({ id: 3819 }),
    getBuildById: vi
      .fn()
      .mockResolvedValue({
        id: 3819,
        buildType: { id: "UAT" },
        state: "finished",
        status: "SUCCESS",
        revisions: { revision: [{ version: expected.commitSha }] },
      }),
    getAcceptanceResult: vi.fn().mockResolvedValue(report()),
  };
  const service = new UatAcceptanceService(
    prisma as unknown as PrismaService,
    {
      resolve: vi.fn().mockResolvedValue("private-teamcity-token"),
    } as unknown as CredentialsService,
    tc as unknown as TeamCityClient,
    {
      getOrThrow: (key: string) =>
        key === "APP_SECRET_KEY" ? "secret" : "http://callback",
    } as unknown as ConfigService,
  );
  return { service, prisma, tc, release };
}

describe("post-release UAT acceptance", () => {
  it("rejects empty/partial/duplicate/cross-release reports", () => {
    expect(validateAcceptanceResult(report(), expected).checks).toHaveLength(8);
    expect(() =>
      validateAcceptanceResult({ ...report(), releaseId: "other" }, expected),
    ).toThrow();
    expect(() =>
      validateAcceptanceResult({ ...report(), checks: [] }, expected),
    ).toThrow();
    const duplicate = report();
    duplicate.checks.push(duplicate.checks[0]!);
    expect(() => validateAcceptanceResult(duplicate, expected)).toThrow();
  });
  it("scans only deployed successful releases and queues exact source without business credentials", async () => {
    const f = fixture();
    await f.service.tick();
    expect(f.prisma.repositoryDeployment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "SUCCESS",
          acceptanceStatus: { in: ["PENDING", "QUEUED", "RUNNING"] },
        },
      }),
    );
    const input = f.tc.queueAcceptanceBuild.mock.calls[0]?.[1];
    expect(input).toMatchObject({
      releaseId: "release",
      commitSha: expected.commitSha,
      sourceBuildId: "3818",
      buildTypeId: "UAT",
    });
    expect(input).not.toHaveProperty("password");
    expect(f.prisma.repositoryDeployment.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ acceptanceStatus: "SUCCESS" }),
      }),
    );
  });
  it("recovers an enqueued task after response loss without queueing a second task", async () => {
    const f = fixture();
    f.tc.findAcceptanceBuild.mockResolvedValue({ id: 3819 });
    await f.service.tick();
    expect(f.tc.queueAcceptanceBuild).not.toHaveBeenCalled();
  });
  it("does not queue after a failed deployment or without a lease", async () => {
    const failed = fixture({ status: "FAILED" });
    await failed.service.tick();
    expect(failed.tc.queueAcceptanceBuild).not.toHaveBeenCalled();
    const f = fixture();
    f.prisma.repositoryDeployment.updateMany.mockResolvedValue({ count: 0 });
    await f.service.tick();
    expect(f.tc.queueAcceptanceBuild).not.toHaveBeenCalled();
  });
  it("keeps deployment success while TC failure rejects an otherwise successful browser report", async () => {
    const f = fixture();
    f.tc.getBuildById.mockResolvedValue({
      id: 3819,
      buildType: { id: "UAT" },
      state: "finished",
      status: "FAILURE",
      revisions: { revision: [{ version: expected.commitSha }] },
    });
    await f.service.tick();
    expect(f.prisma.repositoryDeployment.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ acceptanceStatus: "FAILED" }),
      }),
    );
    for (const call of f.prisma.repositoryDeployment.update.mock.calls)
      expect(call[0].data).not.toHaveProperty("status");
  });
  it("rejects wrong checkout and missing reports", async () => {
    const f = fixture();
    f.tc.getAcceptanceResult.mockResolvedValue(null);
    await f.service.tick();
    expect(f.prisma.repositoryDeployment.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ acceptanceStatus: "FAILED" }),
      }),
    );
  });
  it("rejects forged callbacks before reading remote artifacts", async () => {
    const f = fixture({ acceptanceTeamCityBuildId: "3819" });
    await expect(
      f.service.callback("release", "Bearer forged", "3819"),
    ).rejects.toThrow();
    expect(f.tc.getAcceptanceResult).not.toHaveBeenCalled();
    expect(acceptanceToken("secret", "release")).not.toBe(
      acceptanceToken("secret", "other"),
    );
  });
});
