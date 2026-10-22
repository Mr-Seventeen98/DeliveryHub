/** 对比两种模式的实际编排调用：仓库模式单次入队，原组件模式仍逐组件创建/入队。 */
import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { ProvisioningService } from "./provisioning.service";
import { definitionFixture } from "./repository-pipeline.fixtures";
import type { CreateCiConfigurationDto } from "./dto/create-ci-configuration.dto";

function setup() {
  const registry = {
    id: "registry",
    registryUrl: "https://registry.example.test",
    namespace: "ci",
    usernameCredentialId: "registry-user",
    passwordCredentialId: "registry-password",
  };
  const project = {
    id: "project",
    name: "fixture",
    pathWithNamespace: "ci/fixture",
    gitLabProjectId: 1,
    sshCloneUrl: "git@gitlab.example.test:ci/fixture.git",
    gitLabInstance: {
      apiUrl: "https://gitlab.example.test/api/v4",
      verifySsl: true,
      tokenCredentialId: "gitlab",
    },
  };
  const connection = {
    id: "tc",
    enabled: true,
    baseUrl: "https://tc.example.test",
    parentProjectId: "Root",
    tokenCredentialId: "tc-token",
    verifySsl: true,
  };
  const ok = () => vi.fn().mockResolvedValue({});
  const prisma = {
    gitLabProject: {
      findUnique: vi.fn().mockResolvedValue(project),
      update: ok(),
    },
    teamCityConnection: { findUnique: vi.fn().mockResolvedValue(connection) },
    registryConnection: { findFirst: vi.fn().mockResolvedValue(registry) },
    build: { count: vi.fn().mockResolvedValue(1) },
    application: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "app" }),
      update: ok(),
    },
    component: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: ok(),
      update: ok(),
      upsert: vi.fn(
        async ({ create }: { create: Record<string, unknown> }) => ({
          id: create.code,
          ...create,
        }),
      ),
    },
    ciProvisionTask: {
      create: vi.fn().mockResolvedValue({ id: "task" }),
      update: ok(),
    },
    ciProvisionStep: {
      upsert: vi.fn().mockResolvedValue({ id: "step" }),
      update: ok(),
    },
    teamCityResource: { upsert: ok() },
    teamCityVcsRoot: { upsert: ok() },
    $transaction: vi.fn(async (promises: Promise<unknown>[]) =>
      Promise.all(promises),
    ),
  };
  const files = [
    ...definitionFixture.components.map((component) => component.dockerfile),
    "delivery.yaml",
    definitionFixture.entrypoint,
    definitionFixture.assetsLock,
    definitionFixture.buildEnv,
  ];
  const gitlab = {
    getRepositoryFileRaw: vi
      .fn()
      .mockResolvedValue(JSON.stringify(definitionFixture)),
    listRepositoryTreePage: vi
      .fn()
      .mockResolvedValue(files.map((path) => ({ type: "blob", path }))),
  };
  const tc = {
    getProjectById: vi.fn(async (_config, id) => ({ id, name: "fixture" })),
    createProject: ok(),
    updateProjectName: ok(),
    getVcsRootById: vi.fn().mockResolvedValue(null),
    createVcsRoot: vi.fn(async (_config, input) => input),
    updateVcsRoot: ok(),
    getBuildTypeById: vi.fn().mockResolvedValue(null),
    createBuildType: ok(),
    updateBuildParameters: ok(),
    updateBuildSteps: ok(),
    updateBuildTriggers: ok(),
    configureRepositoryPipeline: ok(),
    hasVcsRootEntry: vi.fn().mockResolvedValue(false),
    attachVcsRoot: ok(),
    queueBuild: vi.fn().mockResolvedValue({ id: 100 }),
  };
  const credentials = { resolve: vi.fn().mockResolvedValue("fixture-only") };
  const service = new ProvisioningService(
    prisma as never,
    credentials as never,
    gitlab as never,
    tc as never,
    { record: ok() } as never,
    new ConfigService({
      APP_SECRET_KEY: "a".repeat(64),
      PUBLIC_CALLBACK_BASE_URL: "https://hub.example.test",
    }),
  );
  const dto: CreateCiConfigurationDto = {
    gitLabProjectId: "project",
    teamCityConnectionId: "tc",
    releaseBranch: "main",
    teamCityGroupMode: "existing",
    teamCityGroupId: "CI",
    autoBuildEnabled: true,
    runFirstBuild: true,
    components: definitionFixture.components.map((component) => ({
      name: component.name,
      dockerfilePath: component.dockerfile,
      imageRepository: component.imageRepository,
    })),
  };
  return { service, prisma, gitlab, tc, dto };
}

describe("CI provisioning compatibility", () => {
  it("已有运行批次时拒绝切换模式，且不修改应用或远端任务", async () => {
    const fixture = setup();
    fixture.prisma.application.findFirst.mockResolvedValue({
      id: "existing",
      ciExecutionMode: "COMPONENT_DOCKER",
    } as never);
    await expect(
      fixture.service.provision(
        { ...fixture.dto, ciExecutionMode: "REPOSITORY_PIPELINE" },
        "user",
        "request",
      ),
    ).rejects.toThrow("存在排队或运行中的构建");
    expect(fixture.prisma.application.update).not.toHaveBeenCalled();
    expect(fixture.tc.createBuildType).not.toHaveBeenCalled();
  });
  it("旧模式保留中文及空格构建目录", async () => {
    const fixture = setup();
    await fixture.service.provision(
      {
        ...fixture.dto,
        components: [
          { ...fixture.dto.components[0]!, buildContext: "服务 目录" },
        ],
      },
      "user",
      "request",
    );
    expect(fixture.prisma.component.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ buildContext: "服务 目录" }),
      }),
    );
  });
  it("仓库文件覆盖浏览器组件选择，创建六阶段且只入队一次", async () => {
    const fixture = setup();
    const result = await fixture.service.provision(
      {
        ...fixture.dto,
        ciExecutionMode: "REPOSITORY_PIPELINE",
        registryConnectionId: "registry",
        components: fixture.dto.components.slice(0, 1),
      },
      "user",
      "request",
    );
    expect(fixture.prisma.component.upsert).toHaveBeenCalledTimes(5);
    expect(fixture.tc.createBuildType).toHaveBeenCalledTimes(1);
    expect(fixture.tc.queueBuild).toHaveBeenCalledTimes(1);
    expect(result.components).toHaveLength(1);
    expect(fixture.tc.createBuildType.mock.calls[0]?.[1]).toMatchObject({
      steps: expect.arrayContaining([
        expect.objectContaining({
          id: "repository_report",
          executionMode: "execute_always",
        }),
      ]),
    });
  });
  it("旧客户端不传模式时，仍创建五个独立任务并逐组件入队", async () => {
    const fixture = setup();
    const result = await fixture.service.provision(
      fixture.dto,
      "user",
      "request",
    );
    expect(fixture.gitlab.getRepositoryFileRaw).not.toHaveBeenCalled();
    expect(fixture.tc.createBuildType).toHaveBeenCalledTimes(5);
    expect(fixture.tc.queueBuild).toHaveBeenCalledTimes(5);
    expect(fixture.tc.configureRepositoryPipeline).not.toHaveBeenCalled();
    expect(result.components).toHaveLength(5);
  });
});
