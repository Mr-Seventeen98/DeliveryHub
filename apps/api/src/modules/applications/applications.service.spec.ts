import { DeploymentEnvironment } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ApplicationsService } from "./applications.service";

describe("ApplicationsService application catalog", () => {
  it("includes existing TeamCity projects that are not managed applications", async () => {
    const managedUpdatedAt = new Date("2026-07-01T00:00:00.000Z");
    const externalUpdatedAt = new Date("2026-08-01T00:00:00.000Z");
    const prisma = {
      application: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "application-1",
            name: "managed-app",
            updatedAt: managedUpdatedAt,
            status: "ACTIVE",
            components: [{ id: "component-1" }],
            gitLabProject: {
              id: "project-1",
              pathWithNamespace: "platform/managed-app",
              namespaceName: "platform",
              webUrl: "https://gitlab.example.com/platform/managed-app",
            },
          },
        ]),
      },
      gitLabProject: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "project-2",
            name: "existing-ci-app",
            path: "existing-ci-app",
            pathWithNamespace: "delivery/existing-ci-app",
            namespaceName: "delivery",
            webUrl: "https://gitlab.example.com/delivery/existing-ci-app",
            defaultBranch: "main",
            updatedAt: externalUpdatedAt,
            teamCityVcsRoots: [
              {
                teamCityProjectId: "Delivery_ExistingCiApp",
                teamCityProjectName: "existing-ci-app",
                teamCityConnection: {
                  id: "teamcity-1",
                  name: "TeamCity",
                  baseUrl: "https://teamcity.example.com",
                },
              },
            ],
          },
        ]),
      },
    };
    const service = new ApplicationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = (await service.list()) as Array<{
      id: string;
      managed: boolean;
      persisted: boolean;
      status?: string;
      gitLabProject: { namespaceName: string };
    }>;

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "external:project-2",
      managed: false,
      persisted: false,
      status: "EXTERNAL",
      gitLabProject: { namespaceName: "delivery" },
    });
    expect(result[1]).toMatchObject({
      id: "application-1",
      managed: true,
      persisted: true,
      gitLabProject: { namespaceName: "platform" },
    });
  });

  it("creates an application owner before configuring an existing project's directories", async () => {
    const create = vi.fn().mockResolvedValue({ id: "application-2" });
    const record = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      application: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
      gitLabProject: {
        findFirst: vi.fn().mockResolvedValue({
          id: "project-2",
          name: "existing-ci-app",
          defaultBranch: "main",
          teamCityVcsRoots: [
            {
              teamCityConnectionId: "teamcity-1",
              teamCityProjectId: "Delivery_ExistingCiApp",
            },
          ],
        }),
      },
    };
    const service = new ApplicationsService(
      prisma as never,
      {} as never,
      {} as never,
      { record } as never,
      {} as never,
    );

    await expect(
      service.importExistingCiProject("project-2", "user-1", "request-1"),
    ).resolves.toEqual({ applicationId: "application-2" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gitLabProjectId: "project-2",
          teamCityConnectionId: "teamcity-1",
          teamCityProjectId: "Delivery_ExistingCiApp",
        }),
      }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "application.import-existing-ci",
        resourceId: "application-2",
      }),
    );
  });

  it("stores deployment directories separately for each environment", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "directory-1",
      applicationId: "application-1",
      name: "正式环境",
      path: "/srv/app",
      environment: DeploymentEnvironment.PRODUCTION,
    });
    const prisma = {
      application: {
        findUnique: vi.fn().mockResolvedValue({ id: "application-1" }),
      },
      applicationDeploymentDirectory: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert,
      },
      server: {
        findUnique: vi.fn().mockResolvedValue({
          id: "server-1",
          enabled: true,
          status: "ONLINE",
          sshAlias: "production",
        }),
      },
    };
    const createDirectory = vi.fn().mockResolvedValue("/srv/app");
    const service = new ApplicationsService(
      prisma as never,
      {} as never,
      {} as never,
      { record: vi.fn() } as never,
      { createDirectory } as never,
    );

    await service.addDeploymentDirectory(
      "application-1",
      {
        name: "正式环境",
        parentPath: "/srv",
        serverId: "server-1",
        environment: DeploymentEnvironment.PRODUCTION,
        createDirectory: true,
        sudoPassword: "temporary-sudo-password",
      },
      "user-1",
      "request-1",
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          applicationId_environment_path: {
            applicationId: "application-1",
            environment: DeploymentEnvironment.PRODUCTION,
            path: "/srv/app",
          },
        },
      }),
    );
    expect(createDirectory).toHaveBeenCalledWith(
      "production",
      "/srv",
      "正式环境",
      "temporary-sudo-password",
    );
  });

  it("can use an existing server directory without creating a child directory", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "directory-1",
      applicationId: "application-1",
      name: "existing-app",
      path: "/srv/existing-app",
      environment: DeploymentEnvironment.TEST,
    });
    const verifyDirectory = vi.fn().mockResolvedValue(undefined);
    const createDirectory = vi.fn();
    const service = new ApplicationsService(
      {
        application: {
          findUnique: vi.fn().mockResolvedValue({ id: "application-1" }),
        },
        applicationDeploymentDirectory: {
          findFirst: vi.fn().mockResolvedValue(null),
          upsert,
        },
        server: {
          findUnique: vi.fn().mockResolvedValue({
            id: "server-1",
            enabled: true,
            status: "ONLINE",
            sshAlias: "production",
          }),
        },
      } as never,
      {} as never,
      {} as never,
      { record: vi.fn() } as never,
      { createDirectory, verifyDirectory } as never,
    );

    await service.addDeploymentDirectory(
      "application-1",
      {
        name: "ignored-for-existing-directory",
        parentPath: "/srv/existing-app/",
        serverId: "server-1",
        environment: DeploymentEnvironment.TEST,
        createDirectory: false,
      },
      "user-1",
      "request-1",
    );

    expect(verifyDirectory).toHaveBeenCalledWith(
      "production",
      "/srv/existing-app",
      undefined,
    );
    expect(createDirectory).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          name: "existing-app",
          path: "/srv/existing-app",
          serverId: "server-1",
        }),
      }),
    );
  });

  it("requires deleting an environment directory before configuring another", async () => {
    const upsert = vi.fn();
    const service = new ApplicationsService(
      {
        application: {
          findUnique: vi.fn().mockResolvedValue({ id: "application-1" }),
        },
        applicationDeploymentDirectory: {
          findFirst: vi.fn().mockResolvedValue({ id: "directory-1" }),
          upsert,
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.addDeploymentDirectory(
        "application-1",
        {
          name: "新目录",
          parentPath: "/srv",
          serverId: "server-1",
          environment: DeploymentEnvironment.PRODUCTION,
        },
        "user-1",
        "request-1",
      ),
    ).rejects.toThrow(
      "Delete the existing directory before configuring this environment",
    );
    expect(upsert).not.toHaveBeenCalled();
  });
});
