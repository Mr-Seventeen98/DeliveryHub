/** 保护发布边界：浮动/混合制品不能执行，历史构建不追溯，成功和失败终态均不重复触碰环境。 */
import { describe, expect, it, vi } from "vitest";
import {
  AutomaticDeploymentsService,
  deploymentCommand,
  releaseImages,
} from "./automatic-deployments.service";
import type { PrismaService } from "../../database/prisma.service";
import type { CredentialsService } from "../credentials/credentials.service";
import type { GitLabProjectsService } from "../gitlab/gitlab-projects.service";
import type { SshExecutorService } from "../servers/ssh-executor.service";

const commit = "a".repeat(40);
const images = () =>
  ["api", "worker", "migration", "web", "visualization"].map((code) => ({
    status: "AVAILABLE",
    commitSha: commit,
    fullName: `registry/ns/${code}:tag`,
    digest: `sha256:${"b".repeat(64)}`,
    component: { code },
  }));
function fixture(status = "PENDING") {
  const enabledAt = new Date();
  const directory = {
    id: "d",
    applicationId: "a",
    path: "/uat",
    enabled: true,
    autoDeployEnabled: true,
    autoDeployEnabledAt: enabledAt,
    autoDeployBranch: "main",
    autoDeployRunnerPath: "scripts/deploy.py",
    server: { enabled: true, status: "ONLINE", sshAlias: "uat" },
    application: {
      gitLabProjectId: "g",
      registryConnection: {
        enabled: true,
        registryUrl: "registry",
        usernameCredentialId: "u",
        passwordCredentialId: "p",
      },
    },
  };
  const prisma = {
    applicationDeploymentDirectory: {
      findMany: vi.fn().mockResolvedValue([{ id: "d" }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(directory),
      findUnique: vi.fn().mockResolvedValue({
        ...directory,
        application: {
          ciExecutionMode: "REPOSITORY_PIPELINE",
          releaseBranch: "main",
        },
      }),
      update: vi.fn(),
    },
    build: {
      findFirst: vi.fn().mockResolvedValue({
        id: "b",
        teamCityBuildId: "3812",
        commitSha: commit,
        images: images(),
      }),
    },
    repositoryDeployment: {
      upsert: vi.fn().mockResolvedValue({ id: "r", status }),
      update: vi.fn(),
    },
  };
  const ssh = {
    runScript: vi.fn().mockResolvedValue({
      output: JSON.stringify({
        status: "SUCCESS",
        commitSha: commit,
        buildId: "3812",
      }),
    }),
  };
  const repository = {
    getDeploymentRunner: vi.fn().mockResolvedValue("print('receipt')"),
  };
  const service = new AutomaticDeploymentsService(
    prisma as unknown as PrismaService,
    {
      resolve: vi.fn().mockResolvedValue("private-value"),
    } as unknown as CredentialsService,
    repository as unknown as GitLabProjectsService,
    ssh as unknown as SshExecutorService,
  );
  return { service, prisma, ssh, repository, enabledAt };
}
describe("verified repository deployment", () => {
  it("pins all five digests and rejects partial, duplicate and cross-commit images", () => {
    expect(releaseImages(commit, images()).api!.pinned).toContain("@sha256:");
    expect(() => releaseImages(commit, images().slice(1))).toThrow();
    const mixed = images();
    mixed[0]!.commitSha = "c".repeat(40);
    expect(() => releaseImages(commit, mixed)).toThrow();
    const duplicate = images();
    duplicate[0]!.component.code = "worker";
    expect(() => releaseImages(commit, duplicate)).toThrow();
    const unverified = images();
    unverified[0]!.status = "FAILED";
    expect(() => releaseImages(commit, unverified)).toThrow();
  });
  it("filters by successful publication, exact branch and activation before executing pinned runner", async () => {
    const f = fixture();
    await f.service.tick();
    expect(f.prisma.build.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "SUCCESS",
          publicationStatus: "VERIFIED",
          branch: { in: ["main", "refs/heads/main"] },
          startedAt: { gte: f.enabledAt },
        }),
      }),
    );
    expect(f.repository.getDeploymentRunner).toHaveBeenCalledWith(
      "g",
      commit,
      "scripts/deploy.py",
    );
    expect(f.ssh.runScript).toHaveBeenCalledTimes(1);
    expect(f.prisma.repositoryDeployment.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCESS" }),
      }),
    );
  });
  it.each(["SUCCESS", "FAILED"])(
    "does not repeat terminal release %s",
    async (status) => {
      const f = fixture(status);
      await f.service.tick();
      expect(f.ssh.runScript).not.toHaveBeenCalled();
    },
  );
  it("does not execute without a database lease", async () => {
    const f = fixture();
    f.prisma.applicationDeploymentDirectory.updateMany.mockResolvedValue({
      count: 0,
    });
    await f.service.tick();
    expect(f.prisma.build.findFirst).not.toHaveBeenCalled();
  });
  it("recovers an interrupted RUNNING attempt through remote receipt", async () => {
    const f = fixture("RUNNING");
    await f.service.tick();
    expect(f.ssh.runScript).toHaveBeenCalledTimes(1);
  });
  it("rejects mismatched remote success and releases target lease", async () => {
    const f = fixture();
    f.ssh.runScript.mockResolvedValue({
      output: JSON.stringify({ status: "SUCCESS", commitSha: "bad" }),
    });
    await f.service.tick();
    expect(f.prisma.repositoryDeployment.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(
      f.prisma.applicationDeploymentDirectory.updateMany,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { deployLeaseToken: null, deployLeaseUntil: null },
      }),
    );
  });
  it("blocks branch/path changes and resets activation on authorized configuration", async () => {
    const f = fixture();
    await expect(
      f.service.configure("d", true, "other", "scripts/deploy.py"),
    ).rejects.toThrow();
    await expect(
      f.service.configure("d", true, "main", "scripts/../bad.py"),
    ).rejects.toThrow();
    await f.service.configure("d", true, "main", "scripts/deploy.py");
    expect(f.prisma.applicationDeploymentDirectory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoDeployEnabledAt: expect.any(Date),
        }),
      }),
    );
  });
  it("keeps shell metacharacters in credential data and removes isolated Docker login directory", () => {
    const script = deploymentCommand(
      "print('safe')",
      {},
      "https://registry/",
      "user",
      "a'$(touch /oops)",
    );
    expect(script).toContain("'a'\"'\"'$(touch /oops)'");
    expect(script).toContain("trap 'rm -rf \"$temp_dir\"'");
    expect(script).toContain("--password-stdin");
  });
});
