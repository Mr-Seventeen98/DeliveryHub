import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AuditResult,
  CredentialType,
  DeploymentEnvironment,
  ExternalResourceStatus,
  ServerStatus,
  SyncStatus,
  TeamCityResourceType,
} from "@prisma/client";
import { posix } from "node:path";
import { TeamCityClient } from "../../adapters/teamcity/teamcity.client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CredentialsService } from "../credentials/credentials.service";
import { SshExecutorService } from "../servers/ssh-executor.service";
import type { CreateApplicationDeploymentDirectoryDto } from "./dto/application-deployment-directory.dto";

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly teamCity: TeamCityClient,
    private readonly audit: AuditService,
    private readonly ssh: SshExecutorService,
  ) {}

  async list(): Promise<unknown[]> {
    const [managedApplications, externallyConfiguredProjects] =
      await Promise.all([
        this.prisma.application.findMany({
          include: {
            gitLabProject: {
              select: {
                id: true,
                pathWithNamespace: true,
                namespaceName: true,
                webUrl: true,
              },
            },
            teamCityConnection: {
              select: { id: true, name: true, baseUrl: true },
            },
            components: {
              where: { enabled: true },
              orderBy: { createdAt: "asc" },
            },
            deploymentDirectories: {
              where: { enabled: true },
              orderBy: { createdAt: "asc" },
            },
            _count: { select: { builds: true } },
            builds: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true, status: true, createdAt: true },
            },
          },
          orderBy: { updatedAt: "desc" },
        }),
        this.prisma.gitLabProject.findMany({
          where: {
            syncStatus: SyncStatus.ACTIVE,
            applications: { none: {} },
            teamCityVcsRoots: { some: { active: true } },
          },
          select: {
            id: true,
            name: true,
            path: true,
            pathWithNamespace: true,
            namespaceName: true,
            webUrl: true,
            defaultBranch: true,
            updatedAt: true,
            teamCityVcsRoots: {
              where: { active: true },
              orderBy: { updatedAt: "desc" },
              take: 1,
              select: {
                teamCityProjectId: true,
                teamCityProjectName: true,
                teamCityConnection: {
                  select: { id: true, name: true, baseUrl: true },
                },
              },
            },
          },
          orderBy: { updatedAt: "desc" },
        }),
      ]);

    return [
      ...managedApplications.map((application) => ({
        ...application,
        managed: application.components.length > 0,
        persisted: true,
        status:
          application.components.length > 0 ? application.status : "EXTERNAL",
      })),
      ...externallyConfiguredProjects.flatMap((project) => {
        const vcsRoot = project.teamCityVcsRoots[0];
        if (!vcsRoot) return [];
        return [
          {
            id: `external:${project.id}`,
            name: project.name,
            code: project.path,
            releaseBranch: project.defaultBranch,
            autoBuildEnabled: false,
            teamCityProjectId: vcsRoot.teamCityProjectId,
            status: "EXTERNAL" as const,
            updatedAt: project.updatedAt,
            managed: false,
            persisted: false,
            gitLabProject: {
              id: project.id,
              pathWithNamespace: project.pathWithNamespace,
              namespaceName: project.namespaceName,
              webUrl: project.webUrl,
            },
            teamCityConnection: vcsRoot.teamCityConnection,
            teamCityProjectName: vcsRoot.teamCityProjectName,
            components: [],
            deploymentDirectories: [],
            _count: { builds: 0 },
            builds: [],
          },
        ];
      }),
    ].sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
  }

  async importExistingCiProject(
    gitLabProjectId: string,
    userId: string,
    requestId: string,
  ): Promise<{ applicationId: string }> {
    const existing = await this.prisma.application.findFirst({
      where: { gitLabProjectId },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (existing) return { applicationId: existing.id };

    const project = await this.prisma.gitLabProject.findFirst({
      where: {
        id: gitLabProjectId,
        syncStatus: SyncStatus.ACTIVE,
        teamCityVcsRoots: { some: { active: true } },
      },
      select: {
        id: true,
        name: true,
        defaultBranch: true,
        teamCityVcsRoots: {
          where: { active: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: {
            teamCityConnectionId: true,
            teamCityProjectId: true,
          },
        },
      },
    });
    const vcsRoot = project?.teamCityVcsRoots[0];
    if (!project || !vcsRoot)
      throw new NotFoundException("Existing CI/CD project not found");

    const application = await this.prisma.application.create({
      data: {
        gitLabProjectId: project.id,
        name: project.name,
        code: `existing-${project.id}`,
        releaseBranch: project.defaultBranch,
        autoBuildEnabled: false,
        teamCityConnectionId: vcsRoot.teamCityConnectionId,
        teamCityProjectId: vcsRoot.teamCityProjectId,
        status: "ACTIVE",
        createdById: userId,
      },
      select: { id: true },
    });
    await this.audit.record({
      userId,
      action: "application.import-existing-ci",
      resourceType: "application",
      resourceId: application.id,
      requestId,
      after: { gitLabProjectId: project.id },
      result: AuditResult.SUCCESS,
    });
    return { applicationId: application.id };
  }

  async listDeploymentDirectories(
    id: string,
    environment?: DeploymentEnvironment,
  ) {
    await this.requireApplication(id);
    return this.prisma.applicationDeploymentDirectory.findMany({
      where: { applicationId: id, enabled: true, environment },
      orderBy: [{ name: "asc" }, { path: "asc" }],
    });
  }

  async addDeploymentDirectory(
    id: string,
    dto: CreateApplicationDeploymentDirectoryDto,
    userId: string,
    requestId: string,
  ) {
    await this.requireApplication(id);
    const existing = await this.prisma.applicationDeploymentDirectory.findFirst(
      {
        where: {
          applicationId: id,
          environment: dto.environment,
          enabled: true,
        },
        select: { id: true },
      },
    );
    if (existing)
      throw new BadRequestException(
        "Delete the existing directory before configuring this environment",
      );

    const server = await this.prisma.server.findUnique({
      where: { id: dto.serverId },
    });
    if (
      !server?.enabled ||
      server.status !== ServerStatus.ONLINE ||
      !server.sshAlias
    ) {
      throw new BadRequestException("Select an online deployment target");
    }
    const shouldCreateDirectory = dto.createDirectory !== false;
    const directoryPath = shouldCreateDirectory
      ? await this.ssh.createDirectory(
          server.sshAlias,
          dto.parentPath,
          dto.name,
          dto.sudoPassword,
        )
      : await this.useExistingDirectory(
          server.sshAlias,
          dto.parentPath,
          dto.sudoPassword,
        );
    const directoryName = shouldCreateDirectory
      ? dto.name.trim()
      : directoryPath.split("/").filter(Boolean).at(-1) || "/";
    const directory = await this.prisma.applicationDeploymentDirectory.upsert({
      where: {
        applicationId_environment_path: {
          applicationId: id,
          environment: dto.environment,
          path: directoryPath,
        },
      },
      create: {
        applicationId: id,
        serverId: server.id,
        name: directoryName,
        path: directoryPath,
        environment: dto.environment,
      },
      update: {
        name: directoryName,
        serverId: server.id,
        enabled: true,
      },
    });
    await this.audit.record({
      userId,
      action: "application.deployment-directory.add",
      resourceType: "application-deployment-directory",
      resourceId: directory.id,
      requestId,
      after: {
        applicationId: id,
        serverId: server.id,
        environment: directory.environment,
        name: directory.name,
        path: directory.path,
      },
      result: AuditResult.SUCCESS,
    });
    return directory;
  }

  private async useExistingDirectory(
    sshAlias: string,
    path: string,
    sudoPassword?: string,
  ): Promise<string> {
    const normalizedPath =
      posix.normalize(path.trim()).replace(/\/+$/, "") || "/";
    await this.ssh.verifyDirectory(sshAlias, normalizedPath, sudoPassword);
    return normalizedPath;
  }

  async removeDeploymentDirectory(
    id: string,
    directoryId: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    const directory =
      await this.prisma.applicationDeploymentDirectory.findFirst({
        where: { id: directoryId, applicationId: id, enabled: true },
      });
    if (!directory)
      throw new NotFoundException("Deployment directory not found");
    await this.prisma.applicationDeploymentDirectory.update({
      where: { id: directoryId },
      data: { enabled: false },
    });
    await this.audit.record({
      userId,
      action: "application.deployment-directory.disable",
      resourceType: "application-deployment-directory",
      resourceId: directoryId,
      requestId,
      before: { applicationId: id, name: directory.name, path: directory.path },
      result: AuditResult.SUCCESS,
    });
  }

  async get(id: string): Promise<unknown> {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: {
        gitLabProject: true,
        teamCityConnection: {
          select: {
            id: true,
            name: true,
            baseUrl: true,
            parentProjectId: true,
          },
        },
        components: { orderBy: { createdAt: "asc" } },
        teamCityResources: { orderBy: { createdAt: "asc" } },
        builds: { orderBy: { createdAt: "desc" }, take: 20 },
        provisionTasks: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    if (!application) throw new NotFoundException("Application not found");
    return application;
  }

  async checkConfiguration(id: string): Promise<{
    checked: number;
    active: number;
    missing: number;
    items: Array<{
      type: TeamCityResourceType;
      id: string;
      name: string;
      status: ExternalResourceStatus;
    }>;
  }> {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: { teamCityConnection: true, teamCityResources: true },
    });
    if (!application) throw new NotFoundException("Application not found");
    const token = await this.credentials.resolve(
      application.teamCityConnection.tokenCredentialId,
      [CredentialType.TEAMCITY_TOKEN],
    );
    const config = {
      baseUrl: application.teamCityConnection.baseUrl,
      token,
      verifySsl: application.teamCityConnection.verifySsl,
    };
    const items = [];
    for (const resource of application.teamCityResources) {
      let exists = true;
      if (resource.resourceType === TeamCityResourceType.PROJECT)
        exists = Boolean(
          await this.teamCity.getProjectById(
            config,
            resource.resourceExternalId,
          ),
        );
      else if (resource.resourceType === TeamCityResourceType.VCS_ROOT)
        exists = Boolean(
          await this.teamCity.getVcsRootById(
            config,
            resource.resourceExternalId,
          ),
        );
      else if (resource.resourceType === TeamCityResourceType.BUILD_TYPE)
        exists = Boolean(
          await this.teamCity.getBuildTypeById(
            config,
            resource.resourceExternalId,
          ),
        );
      const status = exists
        ? ExternalResourceStatus.ACTIVE
        : ExternalResourceStatus.MISSING;
      await this.prisma.teamCityResource.update({
        where: { id: resource.id },
        data: { status, lastVerifiedAt: new Date() },
      });
      items.push({
        type: resource.resourceType,
        id: resource.resourceExternalId,
        name: resource.resourceName,
        status,
      });
    }
    return {
      checked: items.length,
      active: items.filter(
        (item) => item.status === ExternalResourceStatus.ACTIVE,
      ).length,
      missing: items.filter(
        (item) => item.status === ExternalResourceStatus.MISSING,
      ).length,
      items,
    };
  }

  private async requireApplication(id: string): Promise<void> {
    const application = await this.prisma.application.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!application) throw new NotFoundException("Application not found");
  }
}
